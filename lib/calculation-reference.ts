import type { Experiment, ProjectState } from './domain';
import type { MeanInterval } from './experiment-interval';
import type { ExperimentComparison } from './experiment-comparison';

export type CalculationReference =
  | { kind: 'interval'; record: MeanInterval }
  | { kind: 'comparison'; record: ExperimentComparison };
export type CalculationSelection = {
  kind: CalculationReference['kind'];
  id: string;
};

export function calculationReferences(
  experiment: Experiment,
): CalculationReference[] {
  return [
    ...(experiment.intervals ?? []).map((record) => ({
      kind: 'interval' as const,
      record,
    })),
    ...(experiment.comparisons ?? []).map((record) => ({
      kind: 'comparison' as const,
      record,
    })),
  ];
}
export function calculationKey(ref: CalculationReference) {
  return `${ref.kind}:${ref.record.id}`;
}
export function calculationIndices(ref: CalculationReference) {
  return [
    ...new Set(
      ref.kind === 'interval'
        ? ref.record.indices
        : [...ref.record.sampleA.indices, ...ref.record.sampleB.indices],
    ),
  ].toSorted((a, b) => a - b);
}
export function calculationReferenceCurrent(
  state: ProjectState,
  ref: CalculationReference,
) {
  const experiment = state.experiments.find(
    (e) => e.id === ref.record.experimentId,
  );
  if (!experiment || experiment.versions.at(-1)?.id !== ref.record.versionId)
    return false;
  const stored = calculationReferences(experiment).find(
    (r) => calculationKey(r) === calculationKey(ref),
  );
  return !!stored && JSON.stringify(stored) === JSON.stringify(ref);
}
