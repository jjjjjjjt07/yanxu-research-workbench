import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyState,
  uid,
  checkedValue,
  validateEvidence,
  applyExtraction,
  editCell,
  addRule,
  ensureCells,
  evaluateClaim,
  refreshClaims,
  validateRows,
  exportCSV,
  type Block,
  type Experiment,
  type Claim,
  type Project,
} from '../lib/domain.ts';
import { resolveEvidence } from '../lib/evidence.ts';

const blocks: Block[] = [
  {
    id: 'paper:b1',
    page: 3,
    text: 'The training set has 4800 images. The test set contains 1,200 images.',
  },
];
void test('evidence uses source identifiers and a real contiguous quote', () => {
  assert.equal(
    validateEvidence(blocks, 'paper:b1', 'The test set contains 1,200 images.'),
    true,
  );
  // 编造的摘录一律拒绝，无论块编号指向哪里
  assert.equal(
    validateEvidence(blocks, 'paper:b1', 'The test set contains 4,800 images.'),
    false,
  );
  assert.equal(
    validateEvidence(blocks, 'missing', 'The test set contains 4,800 images.'),
    false,
  );
  // 摘录真实但块编号引错时，统一校验会重定位并标记「已校正」，不再整条丢弃
  const relocated = resolveEvidence(blocks, {
    blockId: 'missing',
    quote: 'The test set contains 1,200 images.',
  });
  assert.equal(relocated.ok, true);
  if (relocated.ok) {
    assert.equal(relocated.relocated, true);
    assert.equal(relocated.blockId, 'paper:b1');
  }
});
void test('an invented citation never enters the table as a sourced value', () => {
  const f = emptyState().fields[0];
  const v = checkedValue(
    { value: '500', blockId: 'missing', quote: '500' },
    blocks,
    f,
    0,
  );
  assert.equal(v.value, '');
  assert.equal(v.sourceValid, false);
  assert.equal(v.page, null);
});
void test('page number is derived from stored source, not model output', () => {
  const f = emptyState().fields[0];
  const v = checkedValue(
    { value: '1200', blockId: 'paper:b1', quote: '1,200 images.', page: 99 },
    blocks,
    f,
    0,
  );
  assert.equal(v.page, 3);
});
void test('re-extraction preserves a manually confirmed value as the current value', () => {
  const s = emptyState(),
    f = s.fields[0];
  const v = checkedValue(
    { value: '1200', blockId: blocks[0].id, quote: '1,200 images.' },
    blocks,
    f,
    0,
  );
  applyExtraction(s, 'p', f.id, v);
  editCell(s, s.cells[0].id, { value: '1200', reason: '人工检查' }, blocks);
  applyExtraction(s, 'p', f.id, { ...v, value: '1500' });
  assert.equal(s.cells[0].value, '1200');
  assert.equal(s.cells[0].candidate?.value, '1500');
  assert.equal(s.cells[0].history.length, 1);
});
void test('rules invalidate only the targeted field and retain original values', () => {
  const s = emptyState();
  for (const f of s.fields.slice(0, 2))
    applyExtraction(
      s,
      'p',
      f.id,
      checkedValue(
        { value: '1200', blockId: blocks[0].id, quote: '1,200 images.' },
        blocks,
        f,
        0,
      ),
    );
  addRule(s, s.fields[0].id, 'Only test set');
  assert.equal(s.cells[0].status, 'stale');
  assert.equal(s.cells[1].status, 'pending');
  assert.equal(s.cells[0].value, '1200');
  assert.equal(s.rules[0].version, 1);
  addRule(s, s.fields[0].id, 'Only independent test set');
  assert.equal(s.rules[1].version, 2);
});
void test('manual values with no source remain explicitly unsourced', () => {
  const s = emptyState(),
    f = s.fields[0];
  applyExtraction(s, 'p', f.id, checkedValue({}, blocks, f, 0));
  editCell(
    s,
    s.cells[0].id,
    { value: '300', reason: '人工输入', blockId: '', quote: '' },
    blocks,
  );
  assert.equal(s.cells[0].status, 'confirmed');
  assert.equal(s.cells[0].sourceValid, false);
  assert.equal(s.cells[0].origin, 'manual');
});
void test('blank matrix cells are initialized once', () => {
  const s = emptyState();
  s.papers.push({
    id: 'p',
    title: 'p',
    filename: 'p.txt',
    pages: 1,
    hash: 'x',
    kind: 'text',
    sample: false,
    blockCount: 1,
    importedAt: '',
  });
  ensureCells(s);
  ensureCells(s);
  assert.equal(s.cells.length, s.fields.length);
});
const experiment = (): Experiment => ({
  id: 'e',
  name: 'experiment',
  direction: 'higher',
  versions: [
    {
      id: 'v1',
      at: '',
      filename: 'x.csv',
      rows: [
        { method: 'A', dataset: 'X', metric: 'accuracy', value: 92 },
        { method: 'B', dataset: 'X', metric: 'accuracy', value: 90 },
      ],
    },
  ],
});
const claim = (): Claim => ({
  id: 'c',
  text: 'A > B',
  experimentId: 'e',
  method: 'A',
  otherMethod: 'B',
  dataset: 'X',
  metric: 'accuracy',
  relation: 'higher',
  expected: null,
  checkedVersion: 'v1',
  result: 'pass',
  detail: '',
  needsReview: false,
});
void test('comparisons are restricted to the exact dataset and metric', () => {
  assert.equal(evaluateClaim(claim(), experiment()).result, 'pass');
  assert.equal(
    evaluateClaim({ ...claim(), dataset: 'Y' }, experiment()).result,
    'missing',
  );
});
void test('an experimental update marks linked text for review and recomputes its truth', () => {
  const s = emptyState(),
    e = experiment();
  s.experiments.push(e);
  s.claims.push(claim());
  e.versions.push({
    id: 'v2',
    at: '',
    filename: 'next.csv',
    rows: [
      { method: 'A', dataset: 'X', metric: 'accuracy', value: 88 },
      { method: 'B', dataset: 'X', metric: 'accuracy', value: 90 },
    ],
  });
  refreshClaims(s, 'e');
  assert.equal(s.claims[0].needsReview, true);
  assert.equal(s.claims[0].result, 'fail');
  assert.equal(e.versions[0].rows[0].value, 92);
});
void test('duplicate or nonnumeric data is rejected instead of silently selecting a row', () => {
  const r = { method: 'A', dataset: 'X', metric: 'accuracy', value: 92 };
  assert.throws(() => validateRows([r, r]), /重复/);
  assert.throws(() => validateRows([{ ...r, value: NaN }]), /有效数值/);
  assert.throws(() => validateRows([]), /1—2000/);
});
void test('numeric claims tolerate representation roundoff but not changed results', () => {
  const e = experiment();
  assert.equal(
    evaluateClaim({ ...claim(), relation: 'number', expected: 92 + 1e-12 }, e)
      .result,
    'pass',
  );
  assert.equal(
    evaluateClaim({ ...claim(), relation: 'number', expected: 93 }, e).result,
    'fail',
  );
});
void test('CSV export retains definitions and evidence and neutralizes spreadsheet formula input', () => {
  const s = emptyState();
  s.papers.push({
    id: 'p',
    title: '=HYPERLINK("unsafe")',
    filename: 'a.txt',
    pages: 1,
    hash: 'x',
    kind: 'text',
    sample: false,
    blockCount: 1,
    importedAt: '',
  });
  ensureCells(s);
  const p: Project = {
    id: uid(),
    title: 'test',
    question: '',
    revision: 1,
    createdAt: '',
    updatedAt: '',
    state: s,
  };
  const csv = exportCSV(p);
  assert.ok(csv.includes('字段定义'));
  assert.ok(csv.includes('原文摘录'));
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.startsWith('\uFEFF'));
});
