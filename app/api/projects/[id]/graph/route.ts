import {
  bindings,
  ownerOf,
  mutationGuard,
  json,
  failure,
  readBody,
  getProject,
  ApiError,
  getBlocks,
  ensureRevision,
} from '@/lib/server';
import { z } from 'zod';
import { ensureCells, logActivity, uid, now } from '@/lib/domain';
import { captureSource } from '@/lib/source-reference';
import { makeCitationBinding, saveCitation } from '@/lib/manuscript-citations';
import {
  loadGraph,
  saveGraph,
  graphJobs,
  workerOnline,
} from '@/lib/graph-store';
import { graphAction } from '@/lib/graph-actions';
import { submitGraphJobs } from '@/lib/graph-jobs';
import { reviewRelationType } from '@/lib/relation-review';
import { sha256, contextText, quoteExists } from '@/lib/graph';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(req: Request, ctx: Context) {
  try {
    const owner = await ownerOf(req),
      { id } = await ctx.params,
      p = await getProject(id, owner);
    const [graph, jobs, online, history] = await Promise.all([
      loadGraph(id, owner),
      graphJobs(id, owner),
      workerOnline(),
      bindings()
        .DB.prepare(
          'SELECT revision,hash,action,actor,created_at AS createdAt FROM graph_revisions WHERE project_id=? AND owner=? ORDER BY revision DESC',
        )
        .bind(id, owner)
        .all(),
    ]);
    const contextHash = await sha256(contextText(p));
    const staleBridgeIds = graph.bridges
      .filter((b) => b.contextHash !== contextHash)
      .map((b) => b.id);
    // 关系动作复核：对历史关系**只读**地补一个「需复核 + 建议类型 + 原因」。
    // 不写库、不改写 type，因此不会静默改写已有的关系；人工确认后才会迁移。
    const relations = graph.relations.map((r) => {
      if (r.typeReview) return r;
      const review = reviewRelationType(
        r,
        graph.entities.find((e) => e.id === r.target),
      );
      return review.status === 'needs-review'
        ? { ...r, typeReview: { status: 'needs-review' as const, suggested: review.suggested, reason: review.reason } }
        : r;
    });
    // 存量证据也要能标出「原文摘录待核对」：旧版解析（v2）的双栏页在修复前
    // 可能把两栏文字交错，这类引用需要人工对照原 PDF。这里同样只读计算。
    const evidence = graph.evidence.map((e) => {
      if (e.excerptNeedsReview) return e;
      const paper = p.state.papers.find((x) => x.id === e.paperId);
      const parsing = paper?.parsing;
      if (!parsing || parsing.engine === 'pdfjs-layout-v3') return e;
      const twoColumn = parsing.pages.some(
        (pg) => pg.page === e.page && pg.layout === 'two-column',
      );
      return twoColumn ? { ...e, excerptNeedsReview: true } : e;
    });
    return json({
      projectRevision: p.revision,
      graph: { ...graph, relations, evidence },
      jobs,
      workerOnline: online,
      history: history.results,
      staleBridgeIds,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request, ctx: Context) {
  try {
    mutationGuard(req);
    const owner = await ownerOf(req),
      { id } = await ctx.params;
    return json(await submitGraphJobs(id, owner, await readBody(req)), 201);
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(req: Request, ctx: Context) {
  try {
    mutationGuard(req);
    const owner = await ownerOf(req),
      { id } = await ctx.params,
      body = await readBody(req),
      g = await loadGraph(id, owner);
    if (body.revision !== g.revision)
      throw new ApiError('图谱版本已变化，请刷新后重试。', 409);
    if (body.action === 'evidence.toRecord') {
      const input = z
        .object({
          id: z.string(),
          target: z.enum(['note', 'manuscript']),
          text: z.string().trim().min(1).max(3000),
          reason: z.string().trim().min(1).max(1200),
          projectRevision: z.number().int(),
          manuscriptVersionId: z.string().optional(),
        })
        .parse(body);
      const project = await getProject(id, owner);
      ensureRevision(project, input.projectRevision);
      const evidence = g.evidence.find((e) => e.id === input.id),
        paper = project.state.papers.find((p) => p.id === evidence?.paperId);
      if (!evidence || !paper) throw new ApiError('证据或原文献不存在。', 404);
      const blocks = await getBlocks(owner, id, paper.id);
      if (
        paper.hash !== evidence.documentHash ||
        (await sha256(JSON.stringify(blocks))) !== evidence.parseHash ||
        blocks.find((b) => b.id === evidence.blockId)?.page !== evidence.page
      )
        throw new ApiError('证据对应旧文件或解析版本，请重新构图并核对。', 409);
      try {
        const source = await captureSource(
          paper,
          blocks,
          evidence.blockId,
          evidence.quote,
        );
        if (source.quote !== evidence.quote)
          throw new ApiError(
            '请先纠正图谱摘录首尾的多余空白，再创建关联引用。',
          );
        source.graphEvidence = { id: evidence.id, graphRevision: g.revision };
        source.review = { actor: owner, at: now(), reason: input.reason };
        if (input.target === 'note') {
          if (project.state.notes.length >= 200)
            throw new ApiError('课题笔记已达200条，已有内容未覆盖。', 413);
          project.state.notes.push({
            id: uid(),
            paperId: paper.id,
            blockId: source.blockId,
            text: input.text,
            at: now(),
            source,
          });
          project.state.contextVersion =
            (project.state.contextVersion ?? 1) + 1;
        } else {
          if (
            input.manuscriptVersionId !==
            (project.state.review.versions?.at(-1)?.id ?? 'legacy')
          )
            throw new ApiError('稿件版本已变化，请重新核对。', 409);
          saveCitation(
            project.state.review,
            await makeCitationBinding(
              project.state.review,
              input.text,
              source,
              owner,
              input.reason,
            ),
          );
        }
      } catch (e) {
        if (e instanceof ApiError) throw e;
        throw new ApiError((e as Error).message);
      }
      logActivity(
        project.state,
        `将图谱证据引用到${input.target === 'note' ? '阅读笔记' : '稿件'}：${input.reason}`,
      );
      return json(
        await saveGraph(
          id,
          owner,
          g,
          g.revision,
          '显式引用图谱证据到' + input.target,
          owner,
          [],
          project,
        ),
      );
    }
    if (body.action === 'evidence.toCell') {
      const input = z
        .object({
          id: z.string(),
          fieldId: z.string(),
          value: z.string().trim().min(1).max(1600),
          reason: z.string().trim().min(1).max(1200),
          projectRevision: z.number().int().positive(),
        })
        .parse(body);
      const project = await getProject(id, owner);
      ensureRevision(project, input.projectRevision);
      const evidence = g.evidence.find((e) => e.id === input.id);
      if (!evidence) throw new ApiError('证据不存在。', 404);
      const paper = project.state.papers.find((p) => p.id === evidence.paperId);
      const field = project.state.fields.find((f) => f.id === input.fieldId);
      if (!paper || !field) throw new ApiError('文献或目标字段不存在。', 404);
      const blocks = await getBlocks(owner, id, paper.id);
      if (
        paper.hash !== evidence.documentHash ||
        (await sha256(JSON.stringify(blocks))) !== evidence.parseHash ||
        !quoteExists(blocks, evidence) ||
        blocks.find((b) => b.id === evidence.blockId)?.page !== evidence.page
      )
        throw new ApiError('证据对应旧文献或解析版本，请重新构图后核对。');
      ensureCells(project.state);
      const cell = project.state.cells.find(
        (c) => c.paperId === paper.id && c.fieldId === field.id,
      )!;
      if (cell.candidate)
        throw new ApiError('该单元格已有候选，请先审核后再引用证据。', 409);
      cell.candidate = {
        value: input.value,
        quote: evidence.quote,
        blockId: evidence.blockId,
        page: evidence.page,
        sourceValid: true,
        origin: 'manual',
        note: input.reason,
        fieldVersion: field.version,
        ruleVersion:
          project.state.rules.filter((r) => r.fieldId === field.id).at(-1)
            ?.version ?? 0,
        evidenceRef: {
          id: evidence.id,
          graphRevision: g.revision,
          documentHash: evidence.documentHash,
          parseHash: evidence.parseHash,
        },
      };
      logActivity(
        project.state,
        `引用图谱证据生成「${field.name}」候选；原因：${input.reason}`,
      );
      return json(
        await saveGraph(
          id,
          owner,
          g,
          g.revision,
          '引用证据生成表格候选',
          owner,
          [],
          project,
        ),
      );
    }
    if (body.action === 'job.cancel' || body.action === 'job.retry') {
      const retry = body.action === 'job.retry';
      const changed = await bindings()
        .DB.prepare(
          retry
            ? "UPDATE graph_jobs SET status='queued',attempts=0,next_at=?,updated_at=?,lease=NULL,lease_until=NULL WHERE id=? AND owner=? AND project_id=? AND status='failed' AND error_kind!='stale_input'"
            : "UPDATE graph_jobs SET status='cancelled',updated_at=?,next_at=?,lease=NULL,lease_until=NULL WHERE id=? AND owner=? AND project_id=? AND status IN ('queued','running')",
        )
        .bind(
          new Date().toISOString(),
          new Date().toISOString(),
          String(body.id),
          owner,
          id,
        )
        .run();
      if (!changed.meta.changes)
        throw new ApiError(
          '任务状态不允许此操作；旧输入任务需要重新创建。',
          409,
        );
      return json({ ok: true });
    }
    if (body.action === 'graph.restore') {
      if (!Number.isInteger(body.targetRevision))
        throw new ApiError('请选择历史版本。');
      const row = await bindings()
        .DB.prepare(
          'SELECT data FROM graph_revisions WHERE project_id=? AND owner=? AND revision=?',
        )
        .bind(id, owner, body.targetRevision)
        .first<{ data: string }>();
      if (!row) throw new ApiError('历史版本不存在。', 404);
      const restored = JSON.parse(row.data);
      restored.relations.forEach((r: { status: string }) => {
        if (r.status === 'confirmed') r.status = 'stale';
      });
      restored.bridges.forEach((b: { status: string }) => (b.status = 'stale'));
      return json(
        await saveGraph(
          id,
          owner,
          restored,
          g.revision,
          `恢复图谱v${body.targetRevision}，创建新版本`,
        ),
      );
    }
    const action = await graphAction(g, id, owner, body);
    return json(await saveGraph(id, owner, g, g.revision, action));
  } catch (e) {
    return failure(e);
  }
}
