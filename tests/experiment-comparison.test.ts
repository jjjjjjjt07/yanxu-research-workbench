import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateComparison,
  comparisonAssumptionsSchema,
  multiplicitySchema,
  twoSidedTP,
} from '../lib/experiment-comparison.ts';
import type { Experiment } from '../lib/domain';
const assumptions = comparisonAssumptionsSchema.parse({
  unit: 'points',
  samplingUnit: 'one synthetic run',
  conditions: 'fixed synthetic setup',
  independent: true,
  independenceBasis: 'independent generated runs',
  approximateNormal: true,
  distributionBasis: 'synthetic normal generator',
});
const single = multiplicitySchema.parse({
  kind: 'single',
  count: 1,
  plan: 'One prespecified synthetic comparison.',
  confirmed: true,
});
const selection = {
  methodA: 'A',
  methodB: 'B',
  dataset: 'X',
  metric: 'score',
  design: 'welch' as const,
};
function fixture(a: number[], b: number[]): Experiment {
  return {
    id: 'e',
    name: 'test',
    direction: 'higher',
    versions: [
      {
        id: 'v1',
        filename: 'synthetic.csv',
        at: 'then',
        rows: [
          ...a.map((value, i) => ({
            method: 'A',
            dataset: 'X',
            metric: 'score',
            value,
            runId: String(i + 1),
          })),
          ...b.map((value, i) => ({
            method: 'B',
            dataset: 'X',
            metric: 'score',
            value,
            runId: String(i + 1),
          })),
        ],
      },
    ],
  };
}
const close = (a: number, b: number) =>
  assert.ok(Math.abs(a - b) < 1e-7 * Math.max(1, Math.abs(b)), `${a} != ${b}`);
void test('Welch handles unequal samples and variances with independently integrated reference p-value', async () => {
  const e = fixture([1, 2, 3, 9], [2, 4, 8]),
    before = structuredClone(e);
  const r = await calculateComparison(
    e,
    'v1',
    selection,
    assumptions,
    single,
    'tester',
    'compare',
  );
  // Independent Python standard-library t-density Simpson integration (20,000 intervals).
  close(r.df, 4.834329890330401);
  close(r.t, -0.36404686577682244);
  close(r.standardError, 2.5179908216230213);
  close(r.rawP, 0.7312007051669014);
  assert.equal(r.sampleA.n, 4);
  assert.equal(r.sampleB.n, 3);
  assert.equal(r.rejectNull, false);
  assert.deepEqual(e, before);
});
void test('Bonferroni changes both decision and interval, preserving original-unit effect direction', async () => {
  const e = fixture([1, 2, 3], [4, 5, 6]);
  const a = await calculateComparison(
    e,
    'v1',
    selection,
    assumptions,
    single,
    'tester',
    'one',
  );
  const t = 3 / Math.sqrt(2 / 3),
    s = t / Math.sqrt(t * t + 4),
    analyticP = 1 - (3 * s - s * s * s) / 2;
  close(a.rawP, analyticP);
  assert.equal(a.effect.value, -3);
  assert.equal(a.rejectNull, true);
  assert.ok(a.upper < 0);
  const plan = multiplicitySchema.parse({
    kind: 'bonferroni',
    count: 3,
    plan: 'All three planned method contrasts.',
    confirmed: true,
  });
  const b = await calculateComparison(
    e,
    'v1',
    selection,
    assumptions,
    plan,
    'tester',
    'family',
  );
  close(b.adjustedP, a.rawP * 3);
  assert.equal(b.rejectNull, false);
  assert.ok(b.lower < a.lower && b.upper > a.upper && b.upper > 0);
  close(b.comparisonAlpha, 0.05 / 3);
});
void test('paired comparisons join run IDs rather than row order and retain every pair', async () => {
  const e = fixture([10, 12, 15], [9, 9, 11]);
  const rows = e.versions[0].rows;
  e.versions[0].rows = [...rows.slice(0, 3), rows[5], rows[3], rows[4]];
  const paired = {
    ...assumptions,
    pairingConfirmed: true,
    pairingBasis: 'Same independently generated subject ID.',
  };
  const r = await calculateComparison(
    e,
    'v1',
    { ...selection, design: 'paired' },
    paired,
    single,
    'tester',
    'paired',
  );
  assert.deepEqual(
    r.pairs?.map((p) => p.difference),
    [1, 3, 4],
  );
  assert.deepEqual(
    r.pairs?.map((p) => p.indexB),
    [4, 5, 3],
  );
  close(r.effect.value, 8 / 3);
  assert.equal(r.df, 2);
  close(r.rawP, 1 - Math.abs(r.t) / Math.sqrt(r.t * r.t + 2));
  const reverse = await calculateComparison(
    e,
    'v1',
    { ...selection, methodA: 'B', methodB: 'A', design: 'paired' },
    paired,
    single,
    'tester',
    'reverse',
  );
  close(reverse.effect.value, -r.effect.value);
  close(reverse.lower, -r.upper);
  close(reverse.rawP, r.rawP);
});
void test('missing pairs, unsuitable assumptions and contradictory plans are rejected without changing input', async () => {
  const e = fixture([1, 2, 3], [2, 3]),
    before = structuredClone(e),
    paired = {
      ...assumptions,
      pairingConfirmed: true,
      pairingBasis: 'Known subjects',
    };
  await assert.rejects(
    calculateComparison(
      e,
      'v1',
      { ...selection, design: 'paired' },
      paired,
      single,
      'tester',
      'check',
    ),
    /一一对应/,
  );
  await assert.rejects(
    calculateComparison(
      e,
      'v1',
      { ...selection, design: 'paired' },
      assumptions,
      single,
      'tester',
      'check',
    ),
    /配对比较/,
  );
  await assert.rejects(
    calculateComparison(e, 'v1', selection, paired, single, 'tester', 'check'),
    /不能同时/,
  );
  await assert.rejects(
    calculateComparison(
      e,
      'old',
      selection,
      assumptions,
      single,
      'tester',
      'check',
    ),
    /版本/,
  );
  await assert.rejects(
    calculateComparison(
      e,
      'v1',
      { ...selection, methodB: 'A' },
      assumptions,
      single,
      'tester',
      'check',
    ),
    /不同/,
  );
  assert.throws(() =>
    comparisonAssumptionsSchema.parse({ ...assumptions, independent: false }),
  );
  assert.throws(() =>
    comparisonAssumptionsSchema.parse({
      ...assumptions,
      approximateNormal: false,
    }),
  );
  assert.throws(() => multiplicitySchema.parse({ ...single, count: 2 }));
  assert.throws(() =>
    multiplicitySchema.parse({ ...single, kind: 'bonferroni' }),
  );
  assert.throws(() =>
    multiplicitySchema.parse({ ...single, confirmed: false }),
  );
  assert.deepEqual(e, before);
});
void test('tail probability remains accurate for large t and degeneracy never becomes p=0', async () => {
  const expected = (2 * Math.atan(1e-10)) / Math.PI;
  assert.ok(Math.abs(twoSidedTP(1e10, 1) / expected - 1) < 1e-10);
  assert.equal(twoSidedTP(0, 10), 1);
  assert.throws(() => twoSidedTP(1e200, 1), /精度/);
  await assert.rejects(
    calculateComparison(
      fixture([1, 1], [2, 2]),
      'v1',
      selection,
      assumptions,
      single,
      'tester',
      'check',
    ),
    /标准误/,
  );
  await assert.rejects(
    calculateComparison(
      fixture([1, 2], [2, 3]),
      'v1',
      { ...selection, design: 'paired' },
      {
        ...assumptions,
        pairingConfirmed: true,
        pairingBasis: 'Known subjects',
      },
      single,
      'tester',
      'check',
    ),
    /标准误/,
  );
  const oneConstant = await calculateComparison(
    fixture([5, 5, 5, 5], [2, 4, 8]),
    'v1',
    selection,
    assumptions,
    single,
    'tester',
    'check',
  );
  close(oneConstant.df, 2);
  close(
    oneConstant.rawP,
    1 - Math.abs(oneConstant.t) / Math.sqrt(oneConstant.t ** 2 + 2),
  );
});
