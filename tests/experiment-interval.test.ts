import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateMeanInterval,
  intervalAssumptionsSchema,
} from '../lib/experiment-interval.ts';
import type { Experiment } from '../lib/domain';
const assumptions = intervalAssumptionsSchema.parse({
  unit: 'points',
  samplingUnit: 'one independent synthetic run',
  conditions: 'same synthetic setup',
  independent: true,
  independenceBasis: 'separate generated runs',
  approximateNormal: true,
  distributionBasis: 'known synthetic normal data-generating process',
});
const group = { method: 'A', dataset: 'X', metric: 'accuracy' };
function fixture(values: number[]): Experiment {
  return {
    id: 'e',
    name: 'fixture',
    direction: 'higher',
    versions: [
      {
        id: 'v1',
        filename: 'runs.csv',
        at: 'then',
        rows: values.map((value, i) => ({
          ...group,
          value,
          runId: String(i + 1),
        })),
      },
    ],
  };
}
const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-7 * Math.max(1, Math.abs(b)), `${a} != ${b}`);
void test('mean intervals match analytic t quantiles for df=1 and df=2, with explicit input lineage', async () => {
  const e = fixture([80, 100]),
    before = structuredClone(e);
  const a = await calculateMeanInterval(
    e,
    'v1',
    group,
    assumptions,
    'tester',
    'Check synthetic interval.',
  );
  const t1 = Math.tan(Math.PI * (0.975 - 0.5));
  close(a.critical, t1);
  close(a.standardError, 10);
  close(a.lower, 90 - t1 * 10);
  close(a.upper, 90 + t1 * 10);
  assert.equal(a.confidence, 0.95);
  assert.equal(a.df, 1);
  assert.deepEqual(a.indices, [0, 1]);
  assert.deepEqual(a.runIds, ['1', '2']);
  assert.deepEqual(e, before);
  const b = await calculateMeanInterval(
    fixture([80, 90, 100]),
    'v1',
    group,
    assumptions,
    'tester',
    'Check df2.',
  );
  const q = 2 * 0.975 - 1,
    t2 = q * Math.sqrt(2 / (1 - q * q));
  close(b.critical, t2);
  close(b.mean, 90);
  close(b.sampleSD, 10);
  close(b.lower, 90 - (t2 * 10) / Math.sqrt(3));
});
void test('interval computation rejects missing assumptions, stale versions, ambiguous samples and zero spread', async () => {
  assert.throws(() =>
    intervalAssumptionsSchema.parse({ ...assumptions, independent: false }),
  );
  assert.throws(() =>
    intervalAssumptionsSchema.parse({
      ...assumptions,
      approximateNormal: false,
    }),
  );
  assert.throws(() =>
    intervalAssumptionsSchema.parse({ ...assumptions, unit: ' ' }),
  );
  assert.throws(() =>
    intervalAssumptionsSchema.parse({ ...assumptions, distributionBasis: '' }),
  );
  await assert.rejects(
    calculateMeanInterval(
      fixture([1, 2]),
      'old',
      group,
      assumptions,
      'tester',
      'check',
    ),
    /版本/,
  );
  await assert.rejects(
    calculateMeanInterval(
      fixture([1]),
      'v1',
      group,
      assumptions,
      'tester',
      'check',
    ),
    /至少/,
  );
  await assert.rejects(
    calculateMeanInterval(
      fixture([1, 1]),
      'v1',
      group,
      assumptions,
      'tester',
      'check',
    ),
    /没有变化/,
  );
  await assert.rejects(
    calculateMeanInterval(
      fixture([1, 2]),
      'v1',
      { ...group, dataset: 'missing' },
      assumptions,
      'tester',
      'check',
    ),
    /不存在/,
  );
  await assert.rejects(
    calculateMeanInterval(
      fixture([1, 2]),
      'v1',
      group,
      assumptions,
      'tester',
      '',
    ),
    /说明/,
  );
});
void test('large sample t interval remains finite; overflow or false zero-width intervals are refused', async () => {
  const a = await calculateMeanInterval(
    fixture(Array.from({ length: 2000 }, (_, i) => (i % 2 ? 1 : 0))),
    'v1',
    group,
    assumptions,
    'tester',
    'Check range.',
  );
  assert.equal(a.df, 1999);
  assert.ok(a.critical > 1.96 && a.critical < 1.962);
  assert.ok(a.lower < 0.5 && a.upper > 0.5);
  await assert.rejects(
    calculateMeanInterval(
      fixture([-1e308, 1e308]),
      'v1',
      group,
      assumptions,
      'tester',
      'check',
    ),
    /范围|基础/,
  );
  const tiny = fixture([Number.MIN_VALUE, Number.MIN_VALUE * 2]);
  await assert.rejects(
    calculateMeanInterval(tiny, 'v1', group, assumptions, 'tester', 'check'),
    /范围|变化/,
  );
});
