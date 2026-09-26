import type { Experiment } from './domain';
import {
  calculationReferences,
  type CalculationSelection,
} from './calculation-reference.ts';
import { calculateMeanInterval } from './experiment-interval.ts';
import { calculateComparison } from './experiment-comparison.ts';

export async function captureCalculationReference(
  experiment: Experiment,
  selection: CalculationSelection,
) {
  const ref = calculationReferences(experiment).find(
    (r) => r.kind === selection.kind && r.record.id === selection.id,
  );
  if (!ref) throw new Error('指定计算不属于此实验或已不存在。');
  const r = ref.record;
  if (
    r.experimentId !== experiment.id ||
    r.versionId !== experiment.versions.at(-1)?.id
  )
    throw new Error('计算对应旧实验版本，请先在当前数据上重新计算。');
  const computed =
    ref.kind === 'interval'
      ? await calculateMeanInterval(
          experiment,
          r.versionId,
          {
            method: ref.record.method,
            dataset: r.dataset,
            metric: r.metric,
          },
          ref.record.assumptions,
          r.actor,
          r.reason,
        )
      : await calculateComparison(
          experiment,
          r.versionId,
          {
            methodA: ref.record.sampleA.method,
            methodB: ref.record.sampleB.method,
            dataset: r.dataset,
            metric: r.metric,
            design: ref.record.design,
          },
          ref.record.assumptions,
          ref.record.multiplicity,
          r.actor,
          r.reason,
        );
  // Recalculation intentionally creates a new ID/time; all saved numerical values,
  // assumptions, input references and algorithm identifiers must otherwise match.
  const comparable = ({ id: _id, at: _at, ...rest }: typeof r) => rest;
  if (JSON.stringify(comparable(computed)) !== JSON.stringify(comparable(r)))
    throw new Error('已保存计算与当前输入复算不一致，请重新计算后再引用。');
  return structuredClone(ref);
}
