import { z } from 'zod';
import { bindings, ApiError, getProject, getBlocks } from './server';
import { modelJSON, aiStatus } from './ai';
import {
  graphExtractionSchema,
  supportSchema,
  bridgeSchema,
  checkedExtraction,
  sha256,
  contextText,
  activeEntity,
  visibleRelations,
} from './graph';
import { loadGraph, saveGraph, workerOnline } from './graph-store';
import type { Paper } from './domain';
import { parsingContext } from './pdf-layout';
import { graphExcerpts, anchoredGraphSchema } from './graph-excerpts';
import { batchByBudget, modelInputBudget } from './limits.ts';

type ExtractResult = z.infer<typeof graphExtractionSchema>;
const EXTRACT_PROMPT =
  '根据编号原文片段excerpts抽取最多12个实体、16条关系。只选择与课题相关且有明确依据的内容。不要编写quote或blockId，改为引用实际提供的excerptId，服务器将保存该编号的原文。实体mentions只引用一段包含实体名称的片段，surface必须是该片段中逐字出现的名称（保留断词、连字符）；规范名写name。关系evidence选择能直接支持方向与条件的1—2段原文，不凭常识补边。definition≤80字符、condition≤120字符。实体类型problem/concept/hypothesis/formula/method/data/observation/conclusion；关系类型必须表达原文的真实动作：方法本身使用某组件用uses，论文在某个数据集/基准上训练某方法用trainedOn，在某个数据集/基准上评估某方法用evaluatedOn，依赖depends，支持supports，反对contradicts，限制limits，对比compares，仅有关联用association。禁止把「在某数据集上评估」写成uses。source是使用或支持的一方，target是被使用或支持的一方。相关不是因果，不把引用工作当本篇实验。返回JSON {"entities":[{"key":"e1","name":"名称","type":"method","aliases":[],"domain":"领域","definition":"定义","mentions":[{"excerptId":"实际片段id","surface":"原文中的名称"}]}],"relations":[{"source":"e1","target":"e2","type":"uses","condition":"条件","evidence":[{"excerptId":"实际片段id"}]}]}。缺证据则不输出该项。';

const stamp = () => new Date().toISOString();
export const graphJobSchema = z.object({
  task: z.enum(['extract', 'bridge']),
  paperIds: z.array(z.string()).max(20).default([]),
  source: z.string().optional(),
  target: z.string().optional(),
});
export async function submitGraphJobs(
  projectId: string,
  owner: string,
  input: unknown,
) {
  const body = graphJobSchema.parse(input),
    p = await getProject(projectId, owner),
    db = bindings().DB;
  if (!aiStatus().configured)
    throw new ApiError('请先配置 DeepSeek 服务端密钥。', 503);
  if (!(await workerOnline()))
    throw new ApiError(
      '后台执行器未连接。请启动工作台后台服务后提交任务。',
      503,
    );
  const active = await db
    .prepare(
      "SELECT id FROM graph_jobs WHERE project_id=? AND owner=? AND status IN ('queued','running') LIMIT 1",
    )
    .bind(projectId, owner)
    .first();
  if (active)
    throw new ApiError('当前课题仍有后台任务，请等待完成或取消。', 409);
  const batchId = crypto.randomUUID(),
    at = stamp(),
    contextHash = await sha256(contextText(p)),
    statements: D1PreparedStatement[] = [];
  const jobs: { paperId: string; snapshot: unknown }[] = [];
  if (body.task === 'extract') {
    if (
      !body.paperIds.length ||
      body.paperIds.some((id) => !p.state.papers.some((x) => x.id === id))
    )
      throw new ApiError('请选择当前课题中的文献。');
    for (const id of new Set(body.paperIds)) {
      const paper = p.state.papers.find((x) => x.id === id)!;
      if (paper.coverage === 'metadata')
        throw new ApiError(
          `「${paper.title}」只有书目元数据，请先获取摘要或全文。`,
        );
      const blocks = await getBlocks(owner, projectId, id);
      if (!blocks.some((b) => b.text.trim()))
        throw new ApiError(
          `「${paper.title}」没有可引用文字，请先在阅读页完成 OCR 核对或补充原文。`,
        );
      jobs.push({
        paperId: id,
        snapshot: {
          paper,
          parseHash: await sha256(JSON.stringify(blocks)),
          contextHash,
        },
      });
    }
  } else {
    const graph = await loadGraph(projectId, owner),
      a = graph.entities.find((e) => e.id === body.source && !e.mergedInto),
      b = graph.entities.find((e) => e.id === body.target && !e.mergedInto);
    if (
      !a ||
      !b ||
      a.id === b.id ||
      a.paperIds.every((id) => b.paperIds.includes(id))
    )
      throw new ApiError('请选取来自不同文献的两个节点。');
    jobs.push({
      paperId: '',
      snapshot: {
        source: a.id,
        target: b.id,
        graphRevision: graph.revision,
        contextHash,
      },
    });
  }
  for (const job of jobs)
    statements.push(
      db
        .prepare(
          'INSERT INTO graph_jobs (id,batch_id,owner,project_id,paper_id,task,status,stage,snapshot,next_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          crypto.randomUUID(),
          batchId,
          owner,
          projectId,
          job.paperId,
          body.task,
          'queued',
          'retrieving',
          JSON.stringify(job.snapshot),
          at,
          at,
          at,
        ),
    );
  await db.batch(statements);
  return { batchId, count: jobs.length };
}
type JobRow = {
  id: string;
  owner: string;
  project_id: string;
  paper_id: string;
  task: 'extract' | 'bridge';
  snapshot: string;
  result: string | null;
  status: string;
  attempts: number;
  lease: string | null;
};
type Snapshot = {
  paper?: Paper;
  parseHash?: string;
  contextHash: string;
  source?: string;
  target?: string;
  graphRevision?: number;
};
export async function executeNextGraphJob(scope?: { owner: string; projectId: string }) {
  const db = bindings().DB,
    at = stamp();
  await db
    .prepare(
      'INSERT INTO graph_workers (id,heartbeat) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET heartbeat=excluded.heartbeat',
    )
    .bind('executor', at)
    .run();
  await db
    .prepare(
      "UPDATE graph_jobs SET status='failed',error='达到重试上限；可人工重试。',error_kind='lease_expired',updated_at=? WHERE status='running' AND lease_until<? AND attempts>=3",
    )
    .bind(at, at)
    .run();
  const job = await db
    .prepare(
      "SELECT * FROM graph_jobs WHERE ((status='queued' AND next_at<=?) OR (status='running' AND lease_until<? AND attempts<3)) AND (? IS NULL OR (owner=? AND project_id=?)) ORDER BY created_at LIMIT 1",
    )
    .bind(at, at, scope?.owner ?? null, scope?.owner ?? null, scope?.projectId ?? null)
    .first<JobRow>();
  if (!job) return { idle: true };
  const lease = crypto.randomUUID();
  const claimed = await db
    .prepare(
      "UPDATE graph_jobs SET status='running',attempts=attempts+1,lease=?,lease_until=?,updated_at=?,error=NULL WHERE id=? AND ((status='queued' AND next_at<=?) OR (status='running' AND lease_until<? AND attempts<3))",
    )
    .bind(
      lease,
      new Date(Date.now() + 240000).toISOString(),
      at,
      job.id,
      at,
      at,
    )
    .run();
  if (!claimed.meta.changes) return { idle: true };
  async function stage(stage: string) {
    await db
      .prepare(
        "UPDATE graph_jobs SET stage=?,updated_at=?,lease_until=? WHERE id=? AND lease=? AND status='running'",
      )
      .bind(
        stage,
        stamp(),
        new Date(Date.now() + 240000).toISOString(),
        job!.id,
        lease,
      )
      .run();
  }
  try {
    const snapshot = JSON.parse(job.snapshot) as Snapshot,
      p = await getProject(job.project_id, job.owner);
    const assertCurrent = async () => {
      const latest = await getProject(job.project_id, job.owner);
      if ((await sha256(contextText(latest))) !== snapshot.contextHash)
        throw new ApiError('课题条件已变化，旧结果已隔离，请创建新任务。', 409);
      if (
        snapshot.paper &&
        !latest.state.papers.some(
          (x) => x.id === snapshot.paper!.id && x.hash === snapshot.paper!.hash,
        )
      )
        throw new ApiError('文献版本已变化，旧结果已隔离。', 409);
      const lock = await db
        .prepare('SELECT status,lease FROM graph_jobs WHERE id=?')
        .bind(job.id)
        .first<{ status: string; lease: string }>();
      if (lock?.status !== 'running' || lock.lease !== lease)
        throw new ApiError('任务已取消或租约失效，结果未写入。', 409);
      return latest;
    };
    await assertCurrent();
    let graph = await loadGraph(p.id, job.owner);
    let result: unknown;
    if (job.task === 'extract') {
      const blocks = await getBlocks(job.owner, p.id, job.paper_id);
      if ((await sha256(JSON.stringify(blocks))) !== snapshot.parseHash)
        throw new ApiError('解析版本已变化，旧结果已隔离。', 409);
      await stage('extracting');
      const allExcerpts = graphExcerpts(blocks);
      // 长文分段处理：按预算切批，每批单独调用一次模型，最后合并结果。
      // 所有片段都会被分配进某一批，不做静默截断，也不丢弃页信息。
      const batches = batchByBudget(
        allExcerpts,
        (e) => e.text.length,
        modelInputBudget('graphExcerpts'),
      );
      let raw: ExtractResult;
      if (job.result) {
        raw = graphExtractionSchema.parse(JSON.parse(job.result));
      } else {
        const merged: ExtractResult = { entities: [], relations: [] };
        for (let index = 0; index < batches.length; index++) {
          const batch = batches[index];
          const part = (await modelJSON(
            job.owner,
            p.id,
            `graph-extract-v3:${job.id}:${index}`,
            EXTRACT_PROMPT,
            {
              question: p.question,
              profile: p.state.profile,
              paper: snapshot.paper,
              parsing: parsingContext(snapshot.paper!, blocks),
              batch:
                batches.length > 1
                  ? {
                      index: index + 1,
                      total: batches.length,
                      pages: Array.from(new Set(batch.map((e) => e.page))),
                    }
                  : undefined,
              excerpts: batch,
            },
            anchoredGraphSchema(batch),
          )) as unknown as ExtractResult;
          const tag = `b${index}_`;
          merged.entities.push(
            ...part.entities.map((e, i) => ({
              ...e,
              key: `${tag}${e.key || `e${i}`}`,
            })),
          );
          merged.relations.push(
            ...part.relations.map((r) => ({
              ...r,
              source: `${tag}${r.source}`,
              target: `${tag}${r.target}`,
            })),
          );
        }
        raw = merged;
      }
      const excerpts = allExcerpts;
      const located = checkedExtraction(raw, snapshot.paper!, blocks, snapshot.parseHash!, job.id);
      const missing = raw.entities.filter(e => !located.entities.some(v => v.name === e.name));
      if (missing.length) {
        const repairs = await modelJSON(
          job.owner, p.id, `graph-mention-repair-v1:${job.id}`,
          '仅修复未能定位的实体原文提及。选择实际提供的片段excerptId，surface必须是片段内逐字连续表述，必须保留连字符、换行和大小写。可选择实体在论文中真实出现的别名，但不能引用语义无关的词。不要复写定义或增加实体。找不到直接提及则不返回该key；不允许伪造。只返回JSON {"mentions":[{"key":"待修复实体key","excerptId":"实际片段ID","surface":"逐字原文名称"}]}。',
          { entities: missing, excerpts },
          z.object({ mentions: z.array(z.object({key:z.string(),excerptId:z.string(),surface:z.string().min(1).max(500)})).max(12) }),
        );
        raw = { ...raw, entities: raw.entities.map(e => {
          if (!missing.some(m => m.key === e.key)) return e;
          const candidates = repairs.mentions.filter(m => m.key === e.key);
          if (candidates.length !== 1) return e;
          const repair = candidates[0], excerpt = excerpts.find(x => x.id === repair.excerptId);
          if (!excerpt || !excerpt.text.includes(repair.surface)) return e;
          return {...e, mentions:[{blockId:excerpt.blockId, quote:excerpt.text,surface:repair.surface}]};
        }) };
      }
      await db
        .prepare(
          "UPDATE graph_jobs SET result=? WHERE id=? AND lease=? AND status='running'",
        )
        .bind(JSON.stringify(raw), job.id, lease)
        .run();
      await stage('validating');
      const checked = await modelJSON(
        job.owner,
        p.id,
        `graph-support-v1:${job.id}`,
        '检查每条关系是否由其证据支持，独立检查方向、条件、因果强化、部分变全部、使用变必须和数值单位。仅返回JSON {"checks":[{"index":0,"support":"supported|partial|conflict|unknown","reason":"具体原因"}]}，每条关系一项，index从0开始。没有明确依据用unknown，不给百分比。',
        { entities: raw.entities, relations: raw.relations },
        supportSchema,
      );
      const extracted = checkedExtraction(
        raw,
        snapshot.paper!,
        blocks,
        snapshot.parseHash!,
        job.id,
        checked.checks,
      );
      await assertCurrent();
      graph = await loadGraph(p.id, job.owner);
      // Re-extraction never rewrites reviewed entities/relations; the new run is a separate candidate set.
      graph.entities.push(...extracted.entities);
      graph.mentions.push(...extracted.mentions);
      graph.evidence.push(...extracted.evidence);
      graph.relations.push(...extracted.relations);
      const pages = new Set(blocks.map((b) => b.page));
      graph.coverage.push({
        paperId: job.paper_id,
        runId: job.id,
        totalBlocks: blocks.length,
        blockIds: blocks.map((b) => b.id),
        missingPages: Array.from(
          { length: snapshot.paper!.pages },
          (_, i) => i + 1,
        ).filter((n) => !pages.has(n)),
        warning: [
          snapshot.paper!.coverage === 'abstract'
            ? '仅提供摘要，未获取全文；页码为摘要文本区域。'
            : '基础文本解析；双栏、表格、公式及扫描页需要人工核对。',
          ...extracted.warnings,
          ...parsingContext(snapshot.paper!, blocks).qualityWarnings,
        ].join(' '),
        at: stamp(),
      });
      // 被隔离的候选随图谱一起持久化，界面才能区分「论文未报告」与「未通过证据校验」。
      graph.isolated.push(...extracted.isolated.map((c) => ({ ...c, at: stamp() })));
      if (graph.isolated.length > 300) graph.isolated = graph.isolated.slice(-300);
      result = {
        entities: extracted.entities.length,
        relations: extracted.relations.length,
        // rejected 与 isolated 现在是同一批候选：实体级 + 关系级，每条都有规则与原因。
        rejected: extracted.isolated.length,
        isolated: extracted.isolated.length,
        isolatedEntities: extracted.isolated.filter((c) => c.kind === 'entity').length,
        isolatedRelations: extracted.isolated.filter((c) => c.kind === 'relation').length,
        needsTypeReview: extracted.relations.filter(
          (r) => r.typeReview?.status === 'needs-review',
        ).length,
      };
    } else {
      if (graph.revision !== snapshot.graphRevision)
        throw new ApiError('图谱已变化，请基于当前版本重新生成桥接假设。', 409);
      const ids = [snapshot.source!, snapshot.target!],
        sources = graph.entities.filter((e) => ids.includes(e.id));
      const evidenceIds = new Set(
        graph.mentions
          .filter((m) => ids.includes(activeEntity(graph, m.entityId)))
          .map((m) => m.evidenceId),
      );
      const evidence = graph.evidence.filter((e) => evidenceIds.has(e.id));
      const relations = visibleRelations(graph).filter(
        (r) =>
          r.status !== 'stale' &&
          r.support !== 'conflict' &&
          r.support !== 'unknown' &&
          (ids.includes(r.source) || ids.includes(r.target)),
      );
      await stage('extracting');
      const raw = await modelJSON(
        job.owner,
        p.id,
        `bridge-v1:${job.id}`,
        '提出跨文献候选迁移假设，绝不是已经证明的科研创新。仅根据两侧来源、共同问题、数学结构或方法作用生成最多3项；只有名字相似或证据不足则返回空数组。必须说明映射、条件差异、反例风险和最小验证实验。不要声称学界无人研究。仅返回JSON {"bridges":[{"source":"第一个实体ID","target":"第二个实体ID","question":"问题","mapping":"概念映射","differences":"条件差异","risks":"失败原因","experiment":"可操作最小实验","evidenceIds":["两侧实际证据ID"],"relationIds":["提供的相关关系ID"]}]}。',
        {
          question: p.question,
          profile: p.state.profile,
          sources,
          evidence,
          relations,
        },
        bridgeSchema,
      );
      for (const b of raw.bridges) {
        if (
          !ids.includes(b.source) ||
          !ids.includes(b.target) ||
          b.source === b.target ||
          b.evidenceIds.some((id) => !evidenceIds.has(id)) ||
          b.relationIds.some((id) => !relations.some((r) => r.id === id))
        )
          throw new ApiError('桥接返回了未提供的来源，已拒绝保存。');
        if (
          sources.some(
            (s) =>
              !graph.mentions.some(
                (m) =>
                  activeEntity(graph, m.entityId) === s.id &&
                  b.evidenceIds.includes(m.evidenceId),
              ),
          )
        )
          throw new ApiError('桥接缺少两侧证据，已拒绝保存。');
        graph.bridges.push({
          ...b,
          id: crypto.randomUUID(),
          kind: 'transfer',
          status: 'candidate',
          reason: '待验证假设，不代表迁移有效。',
          contextHash: snapshot.contextHash,
          runId: job.id,
        });
      }
      result = { hypotheses: raw.bridges.length };
    }
    await stage('persisting');
    // Atomic result commit and terminal count, guarded by lease AND current project version.
    const project = await assertCurrent();
    const guard = db
      .prepare(
        "INSERT INTO graph_workers (id,heartbeat) SELECT 'executor',? WHERE NOT EXISTS (SELECT 1 FROM graph_jobs WHERE id=? AND lease=? AND status='running') OR NOT EXISTS (SELECT 1 FROM projects WHERE id=? AND revision=?)",
      )
      .bind(stamp(), job.id, lease, project.id, project.revision);
    const finish = db
      .prepare(
        "UPDATE graph_jobs SET status=?,stage='persisting',result=?,error=NULL,updated_at=?,lease=NULL,lease_until=NULL WHERE id=? AND lease=? AND status='running'",
      )
      .bind(
        job.task === 'extract' && (result as { rejected: number }).rejected > 0
          ? 'partial'
          : 'succeeded',
        JSON.stringify(result),
        stamp(),
        job.id,
        lease,
      );
    await saveGraph(
      p.id,
      job.owner,
      graph,
      graph.revision,
      `${job.task}:${job.id}`,
      'executor',
      [guard, finish],
    );
    return { jobId: job.id, status: 'ended' };
  } catch (e) {
    const message = e instanceof Error ? e.message : '处理失败',
      stale = e instanceof ApiError && e.status === 409;
    const retry = !stale && job.attempts + 1 < 3;
    await db
      .prepare(
        "UPDATE graph_jobs SET status=?,error=?,error_kind=?,next_at=?,updated_at=?,lease=NULL,lease_until=NULL WHERE id=? AND lease=? AND status='running'",
      )
      .bind(
        retry ? 'queued' : 'failed',
        message,
        stale ? 'stale_input' : 'execution',
        new Date(Date.now() + 15000 * 2 ** job.attempts).toISOString(),
        stamp(),
        job.id,
        lease,
      )
      .run();
    return {
      jobId: job.id,
      status: retry ? 'queued' : 'failed',
      error: message,
    };
  }
}
