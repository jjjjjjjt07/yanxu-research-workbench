import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, type Experiment } from '../lib/domain.ts';
import { emptyGraph } from '../lib/graph.ts';
import { calculateMeanInterval } from '../lib/experiment-interval.ts';
import { calculateComparison } from '../lib/experiment-comparison.ts';
import {
  calculationIndices,
  calculationReferenceCurrent,
} from '../lib/calculation-reference.ts';
import { captureCalculationReference } from '../lib/calculation-verification.ts';
import { captureExperiment, saveObservation } from '../lib/observations.ts';
import {
  captureObservationReference,
  observationContext,
  observationCurrent,
} from '../lib/observation-reference.ts';

const assumptions = {
  unit: 'points',
  samplingUnit: 'one independent synthetic run',
  conditions: 'same synthetic setup',
  independent: true as const,
  independenceBasis: 'separate synthetic runs',
  approximateNormal: true as const,
  distributionBasis: 'synthetic test assumption',
};
async function fixture() {
  const state = emptyState();
  const experiment: Experiment = {
    id: 'exp',
    name: 'Synthetic calculation fixture',
    direction: 'higher' as const,
    versions: [
      {
        id: 'v1',
        at: 'then',
        filename: 'runs.csv',
        rows: [
          {
            method: 'A',
            dataset: 'X',
            metric: 'score',
            value: 10,
            runId: 'r1',
          },
          {
            method: 'A',
            dataset: 'X',
            metric: 'score',
            value: 12,
            runId: 'r2',
          },
          {
            method: 'A',
            dataset: 'X',
            metric: 'score',
            value: 15,
            runId: 'r3',
          },
          {
            method: 'B',
            dataset: 'X',
            metric: 'score',
            value: 11,
            runId: 'r3',
          },
          { method: 'B', dataset: 'X', metric: 'score', value: 9, runId: 'r1' },
          { method: 'B', dataset: 'X', metric: 'score', value: 9, runId: 'r2' },
        ],
      },
    ],
  };
  experiment.intervals = [
    await calculateMeanInterval(
      experiment,
      'v1',
      { method: 'A', dataset: 'X', metric: 'score' },
      assumptions,
      'tester',
      'Synthetic interval.',
    ),
  ];
  experiment.comparisons = [
    await calculateComparison(
      experiment,
      'v1',
      {
        methodA: 'A',
        methodB: 'B',
        dataset: 'X',
        metric: 'score',
        design: 'paired',
      },
      { ...assumptions, pairingBasis: 'same run IDs', pairingConfirmed: true },
      {
        kind: 'bonferroni',
        count: 3,
        plan: 'Three planned synthetic comparisons.',
        confirmed: true,
      },
      'tester',
      'Synthetic comparison.',
    ),
  ];
  state.experiments.push(experiment);
  return { state, experiment };
}

void test('saved calculations are recalculated before capture and include every input row', async () => {
  const { state, experiment } = await fixture();
  for (const selection of [
    { kind: 'interval' as const, id: experiment.intervals![0].id },
    { kind: 'comparison' as const, id: experiment.comparisons![0].id },
  ]) {
    const reference = await captureCalculationReference(experiment, selection);
    assert.equal(calculationReferenceCurrent(state, reference), true);
    assert.deepEqual(
      calculationIndices(reference),
      reference.kind === 'interval' ? [0, 1, 2] : [0, 1, 2, 3, 4, 5],
    );
  }
});

void test('calculation-backed observations preserve the record and become stale with changed input', async () => {
  const { state, experiment } = await fixture();
  const calculation = await captureCalculationReference(experiment, {
    kind: 'comparison',
    id: experiment.comparisons![0].id,
  });
  const indices = calculationIndices(calculation);
  const observation = saveObservation(state, {
    text: 'The saved paired comparison was inconclusive after correction.',
    conditions: 'Only under the recorded synthetic assumptions.',
    outcome: 'inconclusive',
    calculation,
    experiment: await captureExperiment(experiment, 'v1', indices, 2000),
    actor: 'tester',
    at: 'now',
    reason: 'Checked the saved calculation.',
  });
  assert.equal(observationCurrent(state, observation), true);
  const context = observationContext(state, [observation.id])[0];
  assert.deepEqual(context.calculation, calculation);
  assert.match(String(context.interpretation), /统计前提与比较计划由用户声明/);
  await captureObservationReference(state, emptyGraph(), observation.id);

  experiment.versions.push({ ...experiment.versions[0], id: 'v2' });
  assert.equal(observationCurrent(state, observation), false);
  await assert.rejects(
    captureObservationReference(state, emptyGraph(), observation.id),
    /实验观察已变化/,
  );
});

void test('tampered or missing saved calculations cannot be cited', async () => {
  const { experiment } = await fixture();
  const id = experiment.intervals![0].id;
  experiment.intervals![0].mean += 1;
  await assert.rejects(
    captureCalculationReference(experiment, { kind: 'interval', id }),
    /复算不一致/,
  );
  await assert.rejects(
    captureCalculationReference(experiment, {
      kind: 'comparison',
      id: 'missing',
    }),
    /不存在/,
  );
});
