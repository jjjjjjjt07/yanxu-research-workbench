import { z } from 'zod';
import {
  ownerOf,
  mutationGuard,
  readBody,
  getProject,
  getBlocks,
  ensureRevision,
  json,
  failure,
  ApiError,
} from '@/lib/server';
import { loadGraph, saveGraph } from '@/lib/graph-store';
import {
  captureExperiment,
  bridgeSnapshot,
  saveObservation,
  withdrawObservation,
} from '@/lib/observations';
import { logActivity, now } from '@/lib/domain';
import { quoteExists, sha256 } from '@/lib/graph';
import { captureObservationReference } from '@/lib/observation-reference';
import { captureCalculationReference } from '@/lib/calculation-verification';
import { calculationIndices } from '@/lib/calculation-reference';
import {
  saveObservationCitation,
  withdrawObservationCitation,
} from '@/lib/observation-citations';
export const dynamic = 'force-dynamic';
const revision = {
  projectRevision: z.number().int(),
  graphRevision: z.number().int(),
  reason: z.string().trim().min(1).max(1200),
};
const schema = z.discriminatedUnion('action', [
  z.object({
    ...revision,
    action: z.literal('cite'),
    id: z.string().optional(),
    observationId: z.string(),
    manuscriptVersionId: z.string(),
    text: z.string().trim().min(1).max(3000),
  }),
  z.object({
    ...revision,
    action: z.literal('citation.withdraw'),
    id: z.string(),
  }),
  z.object({
    ...revision,
    action: z.literal('save'),
    id: z.string().optional(),
    experimentId: z.string(),
    experimentVersionId: z.string(),
    rowIndices: z.array(z.number().int().min(0)).max(20).default([]),
    calculation: z
      .object({
        kind: z.enum(['interval', 'comparison']),
        id: z.string().min(1).max(100),
        confirmed: z.literal(true),
      })
      .strict()
      .optional(),
    bridgeId: z.string().optional(),
    text: z.string().trim().min(1).max(3000),
    conditions: z.string().trim().min(1).max(2000),
    outcome: z.enum(['supports', 'contradicts', 'inconclusive']),
  }),
  z.object({ ...revision, action: z.literal('withdraw'), id: z.string() }),
]);
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    mutationGuard(req);
    const owner = await ownerOf(req),
      { id } = await ctx.params;
    const input = schema.parse(await readBody(req));
    const project = await getProject(id, owner);
    ensureRevision(project, input.projectRevision);
    const graph = await loadGraph(id, owner);
    if (graph.revision !== input.graphRevision)
      throw new ApiError('图谱版本已变化，请重新核对。', 409);
    try {
      if (input.action === 'cite') {
        if (
          input.manuscriptVersionId !==
          (project.state.review.versions?.at(-1)?.id ?? 'legacy')
        )
          throw new ApiError('稿件版本已变化，请重新核对。', 409);
        const source = await captureObservationReference(
          project.state,
          graph,
          input.observationId,
        );
        await saveObservationCitation(
          project.state,
          source,
          input.text,
          owner,
          input.reason,
          input.id,
        );
      } else if (input.action === 'citation.withdraw')
        withdrawObservationCitation(
          project.state,
          input.id,
          owner,
          input.reason,
        );
      else if (input.action === 'withdraw')
        withdrawObservation(
          project.state,
          input.id,
          owner,
          now(),
          input.reason,
        );
      else {
        const experiment = project.state.experiments.find(
          (e) => e.id === input.experimentId,
        );
        if (!experiment) throw new ApiError('当前课题中没有此实验。', 404);
        if (experiment.versions.at(-1)?.id !== input.experimentVersionId)
          throw new ApiError('实验数据已更新，请重新核对。', 409);
        if (input.calculation && input.rowIndices.length)
          throw new ApiError(
            '计算依据自动包含全部参与计算的数据行，请勿同时指定部分行。',
          );
        const calculation = input.calculation
          ? await captureCalculationReference(experiment, input.calculation)
          : undefined;
        const snapshot = input.bridgeId
          ? bridgeSnapshot(graph, input.bridgeId)
          : undefined;
        if (snapshot) {
          if (!snapshot.evidence.length)
            throw new ApiError('该假设尚无原文依据，请先补齐图谱证据。');
          for (const paperId of new Set(
            snapshot.evidence.map((e) => e.paperId),
          )) {
            const paper = project.state.papers.find((p) => p.id === paperId);
            if (!paper) throw new ApiError('假设原文献不可用。', 409);
            const blocks = await getBlocks(owner, id, paperId),
              hash = await sha256(JSON.stringify(blocks));
            for (const evidence of snapshot.evidence.filter(
              (e) => e.paperId === paperId,
            ))
              if (
                paper.hash !== evidence.documentHash ||
                hash !== evidence.parseHash ||
                !quoteExists(blocks, evidence) ||
                blocks.find((b) => b.id === evidence.blockId)?.page !==
                  evidence.page
              )
                throw new ApiError(
                  '假设引用旧原文或解析，请重新构图并核对后关联。',
                  409,
                );
          }
        }
        saveObservation(
          project.state,
          {
            text: input.text,
            conditions: input.conditions,
            outcome: input.outcome,
            experiment: await captureExperiment(
              experiment,
              input.experimentVersionId,
              calculation ? calculationIndices(calculation) : input.rowIndices,
              calculation ? 2000 : 20,
            ),
            ...(calculation ? { calculation } : {}),
            ...(snapshot
              ? { hypothesis: { graphRevision: graph.revision, snapshot } }
              : {}),
            actor: owner,
            at: now(),
            reason: input.reason,
          },
          input.id,
        );
      }
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError((e as Error).message);
    }
    logActivity(
      project.state,
      `${{ save: '保存实验观察', withdraw: '撤回实验观察', cite: '引用实验观察到稿件', 'citation.withdraw': '撤回稿件实验引用' }[input.action]}：${input.reason}`,
    );
    await saveGraph(
      id,
      owner,
      graph,
      graph.revision,
      '实验观察：' + input.action,
      owner,
      [],
      project,
    );
    return json({ project: await getProject(id, owner) });
  } catch (e) {
    return failure(e);
  }
}
