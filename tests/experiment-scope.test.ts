import test from 'node:test';
import assert from 'node:assert/strict';
import type { Experiment } from '../lib/domain.ts';
import { captureExperiment } from '../lib/observations.ts';
import {
  assertScopeMatches,
  experimentScopeKeys,
  findExperimentScope,
  saveExperimentScopes,
} from '../lib/experiment-scope.ts';

function fixture() {
  const experiment: Experiment = {
    id: 'experiment',
    name: 'Structured scope fixture',
    direction: 'higher',
    versions: [
      {
        id: 'v1',
        at: 'then',
        filename: 'fixture.csv',
        rows: [
          {
            method: 'A',
            dataset: 'X',
            metric: 'accuracy',
            value: 10,
            runId: 'r1',
          },
          {
            method: 'A',
            dataset: 'X',
            metric: 'accuracy',
            value: 12,
            runId: 'r2',
          },
          {
            method: 'B',
            dataset: 'Y',
            metric: 'latency',
            value: 30,
          },
        ],
      },
    ],
  };
  const values = [
    {
      dataset: 'X',
      metric: 'accuracy',
      unit: 'percentage points',
      samplingUnit: 'one independently trained run',
      conditions: 'fixed split and preprocessing',
    },
    {
      dataset: 'Y',
      metric: 'latency',
      unit: 'milliseconds per sample',
      samplingUnit: 'one isolated timing run',
      conditions: 'batch size 1 on the recorded device',
    },
  ];
  return { experiment, values };
}

void test('structured scopes cover every dataset/metric and create an immutable version', async () => {
  const { experiment, values } = fixture();
  assert.deepEqual(experimentScopeKeys(experiment.versions[0].rows), [
    { dataset: 'X', metric: 'accuracy' },
    { dataset: 'Y', metric: 'latency' },
  ]);
  const saved = await saveExperimentScopes(
    experiment,
    'v1',
    values,
    'tester',
    'Checked units and conditions.',
  );
  assert.equal(experiment.versions.length, 2);
  assert.deepEqual(saved.rows, experiment.versions[0].rows);
  assert.notEqual(saved.rows, experiment.versions[0].rows);
  assert.equal(
    findExperimentScope(saved.scope, 'X', 'accuracy')?.unit,
    'percentage points',
  );
  const snapshot = await captureExperiment(experiment, saved.id, [0]);
  assert.deepEqual(snapshot.scope, saved.scope);
});

void test('structured scopes reject gaps, duplicates, stale versions and calculation drift', async () => {
  const { experiment, values } = fixture();
  await assert.rejects(
    saveExperimentScopes(experiment, 'v1', values.slice(0, 1), 'tester', 'x'),
    /完整覆盖/,
  );
  await assert.rejects(
    saveExperimentScopes(
      experiment,
      'v1',
      [values[0], values[0]],
      'tester',
      'x',
    ),
    /只能保存一份/,
  );
  const saved = await saveExperimentScopes(
    experiment,
    'v1',
    values,
    'tester',
    'Checked.',
  );
  await assert.rejects(
    saveExperimentScopes(experiment, 'v1', values, 'tester', 'stale'),
    /版本已变化/,
  );
  assert.throws(
    () =>
      assertScopeMatches(experiment, saved.id, 'X', 'accuracy', {
        unit: 'ratio',
        samplingUnit: values[0].samplingUnit,
        conditions: values[0].conditions,
      }),
    /结构化记录不一致/,
  );
  assert.doesNotThrow(() =>
    assertScopeMatches(experiment, saved.id, 'X', 'accuracy', values[0]),
  );
});
