import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  summarizeExperiment,
  buildExperimentStatistics,
} from '../lib/experiment-statistics.ts';
import {
  validateRows,
  evaluateClaim,
  type DataRow,
  type Experiment,
  type Claim,
} from '../lib/domain.ts';
import {
  parseExperimentCsv,
  serializeExperimentCsv,
} from '../lib/experiment-csv.ts';
import {
  reproducibilitySchema,
  saveReproducibility,
} from '../lib/experiment-reproducibility.ts';
const runs = (
  values: number[],
  method = 'A',
  dataset = 'X',
  metric = 'accuracy',
): DataRow[] =>
  values.map((value, i) => ({
    method,
    dataset,
    metric,
    value,
    runId: 'r' + (i + 1),
  }));
const close = (actual: number | null, expected: number, tolerance = 1e-12) =>
  assert.ok(
    actual !== null &&
      Math.abs(actual - expected) <=
        tolerance * Math.max(1, Math.abs(expected)),
    `${actual} != ${expected}`,
  );
void test('run numbers make repetitions explicit and prevent mixed aggregates and duplicate identities', () => {
  const data = runs([1, 2]);
  validateRows(data);
  validateRows([...data, ...runs([3, 4], 'B')]);
  const mixed = [
    { method: 'Single', dataset: 'X', metric: 'accuracy', value: 5 },
    ...data,
  ];
  assert.deepEqual(
    parseExperimentCsv(new TextEncoder().encode(serializeExperimentCsv(mixed)))
      .rows,
    mixed,
    'CSV export must retain runId even when the first group has no run number',
  );
  assert.throws(() => validateRows([data[0], { ...data[1], runId: 'r1' }]));
  assert.throws(() =>
    validateRows([data[0], { ...data[1], runId: undefined }]),
  );
  assert.throws(() => validateRows([{ ...data[0], runId: '' }]));
  const parsed = parseExperimentCsv(
    new TextEncoder().encode(
      'method,dataset,metric,value,runId\nA,X,accuracy,1, run-1 \nA,X,accuracy,2,run-2',
    ),
  );
  assert.deepEqual(
    parsed.rows.map((r) => r.runId),
    ['run-1', 'run-2'],
  );
  assert.deepEqual(parsed.lineRanges, [
    [2, 2],
    [3, 3],
  ]);
});
void test('descriptive statistics match known results and isolate datasets, metrics and singletons', () => {
  const rows = [
    ...runs([2, 4, 4, 4, 5, 5, 7, 9]),
    ...runs([100, 200], 'A', 'Y'),
    ...runs([0], 'A', 'X', 'latency'),
  ];
  const before = structuredClone(rows),
    groups = summarizeExperiment(rows);
  assert.equal(groups.length, 3);
  close(groups[0].mean, 5);
  close(groups[0].sampleSD, Math.sqrt(32 / 7));
  assert.equal(groups[0].n, 8);
  assert.equal(groups[0].min, 2);
  assert.equal(groups[0].max, 9);
  close(groups[1].mean, 150);
  assert.deepEqual(groups[1].indices, [8, 9]);
  assert.equal(groups[2].mean, 0);
  assert.equal(groups[2].sampleSD, null);
  assert.equal(groups[2].issue, 'single_value');
  assert.equal(summarizeExperiment(runs([5, 5, 5]))[0].sampleSD, 0);
  assert.deepEqual(rows, before);
});
void test('numeric calculation handles large offsets, cancellation, large magnitudes and unrepresentable spread', () => {
  const shifted = summarizeExperiment(runs([1e12, 1e12 + 1, 1e12 + 2]))[0];
  assert.equal(shifted.mean, 1e12 + 1);
  close(shifted.sampleSD, 1);
  const cancellation = summarizeExperiment(runs([1e16, 1, -1e16]))[0];
  close(cancellation.mean, 1 / 3);
  close(cancellation.sampleSD, 1e16);
  const big = summarizeExperiment(runs([1e200, 2e200, 3e200]))[0];
  close(big.mean, 2e200);
  close(big.sampleSD, 1e200);
  const outOfRange = summarizeExperiment(
    runs([-Number.MAX_VALUE, Number.MAX_VALUE]),
  )[0];
  assert.equal(outOfRange.mean, 0);
  assert.equal(outOfRange.sampleSD, null);
  assert.equal(outOfRange.issue, 'numeric_range');
  assert.doesNotMatch(JSON.stringify(outOfRange), /Infinity|NaN/);
});
void test('stored statistics identify their immutable input and survive metadata-only version changes', async () => {
  const rows = runs([80, 90, 100]),
    statistics = await buildExperimentStatistics(rows);
  assert.equal(
    statistics.inputDataHash,
    createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
  );
  assert.equal(statistics.countUnit, 'imported_run_records');
  const experiment: Experiment = {
    id: 'e',
    name: 'test',
    direction: 'higher',
    versions: [
      { id: 'v1', at: 'then', filename: 'runs.csv', rows, statistics },
    ],
  };
  const before = structuredClone(experiment.versions[0]);
  const v2 = await saveReproducibility(
    experiment,
    'v1',
    reproducibilitySchema.parse({ randomSeed: 'see run records' }),
    'tester',
    'add context',
  );
  assert.deepEqual(experiment.versions[0], before);
  assert.deepEqual(v2.statistics, statistics);
  assert.notEqual(v2.statistics, statistics);
  const changed = await buildExperimentStatistics(runs([80, 90, 101]));
  assert.notEqual(changed.inputDataHash, statistics.inputDataHash);
});
void test('existing claim checks refuse to substitute a single run or mean for a repeated result', () => {
  const experiment: Experiment = {
    id: 'e',
    name: 'test',
    direction: 'higher',
    versions: [
      {
        id: 'v',
        at: '',
        filename: '',
        rows: [...runs([80, 100]), ...runs([85], 'B')],
      },
    ],
  };
  const claim = {
    method: 'A',
    otherMethod: 'B',
    dataset: 'X',
    metric: 'accuracy',
    relation: 'higher',
    expected: null,
  } as Claim;
  assert.equal(evaluateClaim(claim, experiment).result, 'missing');
  assert.match(evaluateClaim(claim, experiment).detail, /多次运行/);
  assert.equal(
    evaluateClaim({ ...claim, relation: 'number', expected: 80 }, experiment)
      .result,
    'missing',
  );
});
