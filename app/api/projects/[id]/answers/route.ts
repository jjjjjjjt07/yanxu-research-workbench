import {
  bindings,
  ownerOf,
  getProject,
  getBlocks,
  json,
  failure,
  ApiError,
  mutationGuard,
  readBody,
  ensureRevision,
} from '@/lib/server';
import { z } from 'zod';
import { loadGraph, saveGraph } from '@/lib/graph-store';
import { loadAnswer } from '@/lib/answer-store';
import {
  answerEvidenceMatches,
  answerGraphLinks,
  saveAnswerEvidence,
} from '@/lib/answer-evidence';
import { captureSource } from '@/lib/source-reference';
import { observationReferenceCurrent } from '@/lib/observation-reference';
import { logActivity, now } from '@/lib/domain';
import {
  answerPrefix,
  answerStatus,
  type AnswerRecord,
} from '@/lib/answer-history';
import { researchContext } from '@/lib/research-context';
import { sha256 } from '@/lib/graph';
export const dynamic = 'force-dynamic';
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const owner = await ownerOf(req),
      { id } = await ctx.params,
      project = await getProject(id, owner);
    const cursor = new URL(req.url).searchParams.get('cursor') || undefined;
    if (cursor && cursor.length > 2000)
      throw new ApiError('历史分页标识无效。');
    const listed = await bindings().FILES.list({
      prefix: answerPrefix(owner, id),
      limit: 10,
      ...(cursor ? { cursor } : {}),
    });
    const records = await Promise.all(
      listed.objects.map(async (o) => {
        const obj = await bindings().FILES.get(o.key);
        if (!obj) throw new ApiError('历史记录读取失败，请重试。', 503);
        return obj.json<AnswerRecord>();
      }),
    );
    const contextHashes = new Map(
      await Promise.all(
        records.map(
          async (r) =>
            [
              r.id,
              await sha256(
                JSON.stringify(
                  researchContext(project, r.observationIds ?? []),
                ),
              ),
            ] as const,
        ),
      ),
    );
    const graph = await loadGraph(id, owner);
    const hashes: Record<string, string> = {};
    for (const paperId of new Set(
      records.flatMap((r) => r.inputs.map((i) => i.paperId)),
    )) {
      if (project.state.papers.some((p) => p.id === paperId))
        hashes[paperId] = await sha256(
          JSON.stringify(await getBlocks(owner, id, paperId)),
        );
    }
    // Do not label a mixed read as current if a parse changed during this request.
    if ((await getProject(id, owner)).revision !== project.revision)
      throw new ApiError('资料正在更新，请刷新历史记录。', 409);
    if ((await loadGraph(id, owner)).revision !== graph.revision)
      throw new ApiError('图谱正在更新，请刷新历史记录。', 409);
    return json({
      records: records.map((r) => {
        const graphLinks = answerGraphLinks(project.state, graph, r.id);
        const status = answerStatus(
          r,
          project,
          contextHashes.get(r.id)!,
          hashes,
        );
        const graphSourceChanged = graphLinks.some((l) => l.status === 'stale');
        const staleObservationIds = (r.result.observations ?? [])
          .filter((ref) => !observationReferenceCurrent(project.state, ref))
          .map((ref) => ref.id);
        return {
          ...r,
          graphLinks,
          status: {
            ...status,
            graphSourceChanged,
            staleObservationIds,
            needsReview:
              status.needsReview ||
              graphSourceChanged ||
              staleObservationIds.length > 0,
          },
        };
      }),
      cursor: listed.truncated ? listed.cursor : null,
    });
  } catch (e) {
    return failure(e);
  }
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    mutationGuard(req);
    const owner = await ownerOf(req),
      { id } = await ctx.params;
    const input = z
      .object({
        action: z.enum(['link', 'withdraw']),
        answerId: z.string(),
        sourceIndex: z.number().int().min(0),
        evidenceId: z.string().optional(),
        projectRevision: z.number().int(),
        graphRevision: z.number().int(),
        reason: z.string().trim().min(1).max(1200),
      })
      .parse(await readBody(req));
    const project = await getProject(id, owner);
    ensureRevision(project, input.projectRevision);
    const graph = await loadGraph(id, owner);
    if (graph.revision !== input.graphRevision)
      throw new ApiError('图谱版本已变化，请重新核对。', 409);
    const record = await loadAnswer(owner, id, input.answerId);
    const original = record.result.sources[input.sourceIndex];
    if (!original?.reference)
      throw new ApiError('此条依据没有原文版本快照，请重新提问后关联。');
    let source = original.reference;
    try {
      if (input.action === 'link') {
        const evidence = graph.evidence.find((e) => e.id === input.evidenceId);
        if (!evidence) throw new ApiError('图谱证据不存在。', 404);
        if (!answerEvidenceMatches(record, input.sourceIndex, evidence))
          throw new ApiError(
            '图谱证据与回答依据的原文、位置或版本不完全一致，请先核对摘录。',
          );
        const paper = project.state.papers.find((p) => p.id === source.paperId);
        if (!paper) throw new ApiError('原文献不存在。', 404);
        const captured = await captureSource(
          paper,
          await getBlocks(owner, id, paper.id),
          source.blockId,
          source.quote,
        );
        if (
          captured.documentHash !== source.documentHash ||
          captured.parseHash !== source.parseHash ||
          captured.parseVersionId !== source.parseVersionId ||
          captured.page !== source.page ||
          captured.quote !== source.quote
        )
          throw new ApiError(
            '回答引用旧文件或解析版本，请重新提问后关联。',
            409,
          );
        source = {
          ...source,
          graphEvidence: { id: evidence.id, graphRevision: graph.revision },
        };
      }
      saveAnswerEvidence(
        project.state,
        {
          answerId: record.id,
          sourceIndex: input.sourceIndex,
          source,
          actor: owner,
          at: now(),
          reason: input.reason,
        },
        input.action === 'withdraw',
      );
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError((e as Error).message);
    }
    logActivity(
      project.state,
      `${input.action === 'link' ? '关联问答图谱证据' : '撤回问答图谱关联'}：${input.reason}`,
    );
    await saveGraph(
      id,
      owner,
      graph,
      graph.revision,
      '问答图谱关联：' + input.action,
      owner,
      [],
      project,
    );
    return json({ ok: true });
  } catch (e) {
    return failure(e);
  }
}
