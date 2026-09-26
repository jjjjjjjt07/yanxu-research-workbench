import {
  bindings,
  json,
  failure,
  getProject,
  getBlocks,
  saveProject,
  ApiError,
} from '@/lib/server';
import type { z } from 'zod';
import { modelJSON, extractionSchema } from '@/lib/ai';
import { batchByBudget, modelInputBudget } from '@/lib/limits';
import { mergeFieldCells } from '@/lib/imports';
import { researchContext } from '@/lib/research-context';
import { parsingContext } from '@/lib/pdf-layout';
import {
  now,
  checkedValue,
  applyExtraction,
  logActivity,
  recordRejectedCandidate,
  type Field,
  type Rule,
} from '@/lib/domain';

const EXTRACT_FIELD_PROMPT =
  '你是严谨的文献信息提取助手。按字段定义和项目规则从提供的文献内容提取。规则以同一字段的最近一版为准。每个字段输出一项；值需由引用的单个原文块及其连续摘录支持，不能补全未报告的事实。有多个不可合并的实验结果时应说明范围，无法可靠归纳则保留未知。没有依据时 value、blockId、quote 为空并填写 note。当 payload 带有 batch 字段时，表示这是分段的其中一段，只依据本段文字作答，不要臆测其他段的内容。返回 {"cells":[{"fieldId":"字段编号","value":"字符串值","blockId":"提供的块编号","quote":"原文连续摘录","note":"必要说明"}]}。不要生成页码。';
type JobRow = {
  id: string;
  owner: string;
  project_id: string;
  paper_id: string;
  field_ids: string;
  status: string;
  error: string | null;
  snapshot: string;
  result: string | null;
  attempts: number;
  updated_at: string;
};
export async function runExtractionJob(
  owner: string,
  id: string,
  action: string,
) {
  let job: JobRow | null = null;
  let acquired = false;
  try {
    if (!['run', 'cancel'].includes(action))
      throw new ApiError('未知的任务操作。');
    const db = bindings().DB;
    job = await db
      .prepare('SELECT * FROM jobs WHERE id=? AND owner=?')
      .bind(id, owner)
      .first<JobRow>();
    if (!job) throw new ApiError('任务不存在。', 404);
    if (action === 'cancel') {
      if (['succeeded', 'cancelled'].includes(job.status))
        return json({ status: job.status });
      await db
        .prepare("UPDATE jobs SET status='cancelled',updated_at=? WHERE id=?")
        .bind(now(), id)
        .run();
      return json({ status: 'cancelled' });
    }
    if (job.status === 'succeeded') return json({ status: 'succeeded' });
    if (job.status === 'cancelled') throw new ApiError('任务已取消。');
    if (job.attempts >= 3)
      throw new ApiError('任务已达到三次尝试上限，请取消后创建新任务。');
    const locked = await db
      .prepare(
        "UPDATE jobs SET status='running',attempts=attempts+1,error=NULL,updated_at=? WHERE id=? AND attempts=? AND attempts<3 AND (status IN ('queued','failed') OR (status='running' AND updated_at<?))",
      )
      .bind(
        now(),
        id,
        job.attempts,
        new Date(Date.now() - 120000).toISOString(),
      )
      .run();
    if (!locked.meta.changes) {
      job = null;
      throw new ApiError('任务正在处理中，请稍后刷新。', 409);
    }
    acquired = true;
    const p = await getProject(job.project_id, owner),
      blocks = await getBlocks(owner, p.id, job.paper_id),
      snapshot = JSON.parse(job.snapshot) as {
        fields: Field[];
        rules: Rule[];
        paperHash?: string;
        context?: string;
        contextVersion?: number;
      };
    const assertCurrent = (project: typeof p) => {
      if (
        snapshot.context !== undefined &&
        (snapshot.context !== JSON.stringify(researchContext(project)) ||
          snapshot.contextVersion !== (project.state.contextVersion ?? 0))
      )
        throw new ApiError(
          '课题条件或阅读记录已变化，旧结果已隔离，请重新创建任务。',
          409,
        );
      const paper = project.state.papers.find((x) => x.id === job!.paper_id);
      if (!paper || (snapshot.paperHash && paper.hash !== snapshot.paperHash))
        throw new ApiError('文献版本已变化，请重新创建任务。', 409);
      for (const f of snapshot.fields) {
        const current = project.state.fields.find((x) => x.id === f.id);
        if (!current || current.version !== f.version)
          throw new ApiError('字段定义已变化，请重新创建提取任务。', 409);
        const currentRules = project.state.rules.filter(
          (r) => r.fieldId === f.id,
        );
        if (
          JSON.stringify(currentRules) !==
          JSON.stringify(snapshot.rules.filter((r) => r.fieldId === f.id))
        )
          throw new ApiError('提取规则已变化，请重新创建任务。', 409);
      }
    };
    assertCurrent(p);
    let result: z.infer<typeof extractionSchema>;
    if (job.result) {
      result = extractionSchema.parse(JSON.parse(job.result));
    } else {
      // 长文分段处理：按预算切批逐批提取，再按字段合并。
      // 全文始终完整保存，这里只是限制「单次模型任务的输入量」。
      const batches = batchByBudget(
        blocks,
        (b) => b.text.length,
        modelInputBudget('extract'),
      );
      const cells: z.infer<typeof extractionSchema>['cells'] = [];
      for (let index = 0; index < batches.length; index++) {
        const batch = batches[index];
        const part = await modelJSON(
          owner,
          p.id,
          batches.length > 1
            ? `extract-v1:${job.id}:${index}`
            : `extract-v1:${job.id}`,
          EXTRACT_FIELD_PROMPT,
          {
            project: researchContext(p),
            fields: snapshot.fields,
            rules: snapshot.rules,
            batch:
              batches.length > 1
                ? {
                    index: index + 1,
                    total: batches.length,
                    pages: Array.from(new Set(batch.map((b) => b.page))),
                  }
                : undefined,
            blocks: batch,
            parsing: parsingContext(
              p.state.papers.find((paper) => paper.id === job!.paper_id)!,
              batch,
            ),
            materialLimit:
              '只依据已提取文字。解析缺页不等于论文未报告；图像、表格和公式可能未完整提取。遇到这些问题请保留未知并说明。',
          },
          extractionSchema,
        );
        cells.push(...part.cells);
      }
      result = { cells: mergeFieldCells(cells) };
    }
    for (const f of snapshot.fields)
      if (result.cells.filter((c) => c.fieldId === f.id).length > 1)
        throw new ApiError('模型为同一字段返回多个结果，请重试。');
    await db
      .prepare(
        "UPDATE jobs SET result=? WHERE id=? AND attempts=? AND status='running'",
      )
      .bind(JSON.stringify(result), job.id, job.attempts + 1)
      .run();
    const latest = await getProject(p.id, owner);
    assertCurrent(latest);
    const targetPaperId = job.paper_id;
    const paperRow = latest.state.papers.find((x) => x.id === targetPaperId)!;
    // 旧版解析（v2）的双栏页需要在界面上标出「原文摘录待核对」。
    const layoutCtx = {
      engine: paperRow.parsing?.engine,
      twoColumnPages: (paperRow.parsing?.pages ?? [])
        .filter((pg) => pg.layout === 'two-column')
        .map((pg) => pg.page),
    };
    for (const f of snapshot.fields) {
      const values = result.cells.filter((c) => c.fieldId === f.id);
      if (values.length > 1)
        throw new ApiError('模型为同一字段返回多个结果，请重试。');
      const raw = values[0] ?? {
        value: '',
        blockId: '',
        quote: '',
        note: '模型未提供该字段。',
      };
      const version =
        snapshot.rules.filter((r) => r.fieldId === f.id).at(-1)?.version ?? 0;
      const checked = checkedValue(raw, blocks, f, version, 'ai', (draft) => {
        // 候选未通过校验或需人工核对时留下可追溯记录：哪篇、哪页、哪条规则、可读原因。
        recordRejectedCandidate(latest.state, {
          kind: 'field',
          paperId: targetPaperId,
          paperTitle: paperRow.title,
          page: draft.located?.page ?? draft.page,
          label: f.name,
          value: draft.value.slice(0, 300),
          quote: (draft.located?.quote ?? draft.quote).slice(0, 400),
          rule: draft.rule,
          reason: draft.reason,
          stage: 'extraction',
          disposition: draft.pendingReview ? 'pending-review' : 'rejected',
          ...(draft.located ? { located: draft.located } : {}),
        });
      }, layoutCtx);
      applyExtraction(latest.state, job.paper_id, f.id, checked);
    }
    logActivity(
      latest.state,
      '完成文献提取：' +
        (latest.state.papers.find((x) => x.id === job!.paper_id)?.title ?? ''),
    );
    await saveProject(latest, owner, latest.revision, [
      db
        .prepare(
          "INSERT INTO jobs SELECT * FROM jobs WHERE id=? AND (status!='running' OR attempts!=?)",
        )
        .bind(job.id, job.attempts + 1),
      db
        .prepare(
          "UPDATE jobs SET status='succeeded',error=NULL,updated_at=? WHERE id=? AND status='running' AND attempts=?",
        )
        .bind(now(), job.id, job.attempts + 1),
    ]);
    return json({ status: 'succeeded' });
  } catch (e) {
    if (job && acquired)
      await bindings()
        .DB.prepare(
          "UPDATE jobs SET status='failed',error=?,updated_at=? WHERE id=? AND attempts=? AND status='running'",
        )
        .bind(
          e instanceof Error ? e.message : '处理失败',
          now(),
          job.id,
          job.attempts + 1,
        )
        .run();
    return failure(e);
  }
}
