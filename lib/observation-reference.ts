import type { ProjectState } from './domain';
import type { Observation, ObservationSnapshot } from './observations';
import { captureExperiment, observationGraphMatches } from './observations.ts';
import type { Graph } from './graph';
import {
  calculationIndices,
  calculationReferenceCurrent,
} from './calculation-reference.ts';

export type ObservationReference = {
  id: string;
  revision: number;
  snapshot: ObservationSnapshot;
};
export function observationReference(o: Observation): ObservationReference {
  const { id, revision, status: _status, history: _history, ...snapshot } = o;
  return { id, revision: revision ?? 1, snapshot: structuredClone(snapshot) };
}
export function observationCurrent(state: ProjectState, o: Observation) {
  const experiment = state.experiments.find((e) => e.id === o.experiment.id);
  return (
    o.status === 'recorded' &&
    experiment?.versions.at(-1)?.id === o.experiment.versionId &&
    (!o.calculation ||
      (o.calculation.record.experimentId === o.experiment.id &&
        o.calculation.record.versionId === o.experiment.versionId &&
        calculationReferenceCurrent(state, o.calculation)))
  );
}
export function observationReferenceCurrent(
  state: ProjectState,
  ref: ObservationReference,
) {
  const o = state.observations?.find((o) => o.id === ref.id);
  return (
    !!o && observationCurrent(state, o) && (o.revision ?? 1) === ref.revision
  );
}
export function observationContext(
  state: ProjectState,
  ids: string[],
): Record<string, unknown>[] {
  return ids.map((id) => {
    const o = state.observations?.find((o) => o.id === id);
    if (!o || !observationCurrent(state, o))
      return { id, status: o?.status ?? 'missing' };
    const experiment = structuredClone(o.experiment);
    const record = experiment.reproducibility;
    const { uncommittedDiff, ...metadata } = record?.metadata ?? {};
    return {
      id,
      revision: o.revision ?? 1,
      status: o.status,
      text: o.text,
      conditions: o.conditions,
      outcome: o.outcome,
      ...(o.calculation ? { calculation: structuredClone(o.calculation) } : {}),
      ...(o.calculation
        ? {
            calculationValidation:
              '服务器在本次引用前已根据不可变数据版本复算并匹配保存记录。只验证算术与输入血缘，不验证用户声明的统计前提、比较计划或因果解释。',
          }
        : {}),
      experiment: {
        ...experiment,
        ...(record
          ? {
              reproducibility: {
                ...record,
                metadata: {
                  ...metadata,
                  uncommittedDiffRecorded: !!uncommittedDiff,
                },
              },
            }
          : {}),
      },
      interpretation: o.calculation
        ? '用户实验的已保存计算及人工解释；计算数值在引用时复核，但统计前提与比较计划由用户声明，未被软件证实。只能在所列条件下解释已有区间/检验，不把未拒绝零差异解释为等效，不证明因果或独立复现。不是论文事实。'
        : '用户实验观察和人工判断；不是论文事实，不代表统计显著性或独立验证。',
    };
  });
}
export async function captureObservationReference(
  state: ProjectState,
  graph: Graph,
  id: string,
) {
  const o = state.observations?.find((o) => o.id === id);
  if (
    !o ||
    !observationCurrent(state, o) ||
    !observationGraphMatches(state, graph, o)
  )
    throw new Error('实验观察已变化、撤回或待复查，请先核对。');
  const experiment = state.experiments.find((e) => e.id === o.experiment.id)!;
  if (o.calculation) {
    const { captureCalculationReference } =
      await import('./calculation-verification.ts');
    const verified = await captureCalculationReference(experiment, {
      kind: o.calculation.kind,
      id: o.calculation.record.id,
    });
    if (
      JSON.stringify(verified) !== JSON.stringify(o.calculation) ||
      JSON.stringify(calculationIndices(verified)) !==
        JSON.stringify(o.experiment.rows.map((r) => r.index))
    )
      throw new Error('计算依据或完整输入行与观察快照不一致，请重新核对。');
  }
  const snapshot = await captureExperiment(
    experiment,
    o.experiment.versionId,
    o.experiment.rows.map((r) => r.index),
    o.calculation ? 2000 : 20,
  );
  if (JSON.stringify(snapshot) !== JSON.stringify(o.experiment))
    throw new Error('实验数据与观察快照不一致，请先重新核对。');
  return observationReference(o);
}
export function validateObservationIndices(indices: number[], count: number) {
  const valid =
    indices.every((i) => Number.isInteger(i) && i >= 0 && i < count) &&
    new Set(indices).size === indices.length;
  return {
    valid,
    indices: [
      ...new Set(
        indices.filter((i) => Number.isInteger(i) && i >= 0 && i < count),
      ),
    ],
  };
}
