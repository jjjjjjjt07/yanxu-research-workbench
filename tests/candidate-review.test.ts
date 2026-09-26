import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyState,
  ensureCells,
  cellSnapshot,
  type Paper,
} from '../lib/domain.ts';
import {
  candidateDifference,
  valueDifference,
  textDifference,
  applyCandidateDecision,
} from '../lib/candidate-review.ts';
function fixture() {
  const state = emptyState();
  state.papers = [{ id: 'paper' } as Paper];
  ensureCells(state);
  const cell = state.cells[0];
  Object.assign(cell, {
    value: 'Method A',
    blockId: 'b',
    quote: 'Method A used Dataset X.',
    page: 1,
    sourceValid: true,
    note: '',
    status: 'confirmed',
    origin: 'manual',
  });
  cell.candidate = { ...cellSnapshot(cell), origin: 'ai' };
  return { state, cell };
}
void test('unit equivalence is exact, dimensional and never automatically batch accepted', () => {
  assert.equal(valueDifference('1000 ms', '1 s'), 'unit');
  assert.equal(valueDifference('0.1 s', '100 ms'), 'unit');
  assert.equal(valueDifference('-0.5 g', '-500 mg'), 'unit');
  assert.notEqual(valueDifference('1000 ms', '1 m'), 'unit');
  assert.notEqual(valueDifference('50%', '0.5'), 'unit');
  assert.notEqual(valueDifference('1 mM', '1000 MM'), 'unit');
  const { state, cell } = fixture();
  cell.value = '1000 ms';
  cell.candidate!.value = '1 s';
  assert.equal(candidateDifference(state, cell)?.batchAcceptable, false);
});
void test('only whitespace formatting preserves batch eligibility; case and exponents do not', () => {
  const { state, cell } = fixture();
  cell.candidate!.value = 'Method  A';
  assert.equal(candidateDifference(state, cell)?.batchAcceptable, true);
  assert.equal(valueDifference('x²', 'x2'), 'number');
  assert.equal(valueDifference('mM', 'MM'), 'text');
  assert.equal(valueDifference('1200', '1 200'), 'number');
});
void test('same values cannot hide changed evidence, notes, warnings or definitions', () => {
  for (const change of [
    'quote',
    'note',
    'field',
    'source',
    'status',
    'reference',
  ]) {
    const { state, cell } = fixture();
    if (change === 'quote') cell.candidate!.quote += ' Extra context.';
    if (change === 'note') cell.candidate!.note = 'Different test condition';
    if (change === 'field') state.fields[0].version++;
    if (change === 'source') cell.candidate!.sourceValid = false;
    if (change === 'status') cell.status = 'stale';
    if (change === 'reference')
      cell.candidate!.evidenceRef = {
        id: 'new-source',
        graphRevision: 1,
        documentHash: 'doc',
        parseHash: 'parse',
      };
    assert.equal(
      candidateDifference(state, cell)?.batchAcceptable,
      false,
      change,
    );
  }
});
void test('accepting a candidate retains before, proposal, result, actor and common batch identity', () => {
  const { state, cell } = fixture();
  cell.candidate!.value = 'Method  A';
  applyCandidateDecision(
    state,
    cell,
    'accept',
    'reviewer',
    'Whitespace checked',
    'batch-1',
  );
  assert.equal(cell.value, 'Method  A');
  assert.equal(cell.candidate, undefined);
  assert.equal(cell.history[0].value.value, 'Method A');
  const decision = state.candidateReviews![0];
  assert.equal(decision.actor, 'reviewer');
  assert.equal(decision.batchId, 'batch-1');
  assert.equal(decision.before.value, 'Method A');
  assert.equal(decision.candidate.value, 'Method  A');
  assert.equal(decision.after.value, 'Method  A');
});
void test('retaining the current value records the rejected candidate without falsely clearing stale status', () => {
  const { state, cell } = fixture();
  cell.status = 'stale';
  cell.candidate!.value = 'Different method';
  applyCandidateDecision(
    state,
    cell,
    'retain',
    'reviewer',
    'Incompatible context',
  );
  assert.equal(cell.value, 'Method A');
  assert.equal(cell.status, 'stale');
  assert.equal(cell.candidate, undefined);
  assert.equal(state.candidateReviews![0].candidate.value, 'Different method');
  assert.equal(state.candidateReviews![0].decision, 'retain');
});
void test('character differences preserve exact before and after including Unicode', () => {
  for (const [before, after] of [
    ['', '未知'],
    ['A😀B', 'A🧪B'],
    ['x = 1.0', 'x = 10'],
    ['same', 'same'],
  ]) {
    const diff = textDifference(before, after);
    assert.equal(diff.prefix + diff.removed + diff.suffix, before);
    assert.equal(diff.prefix + diff.added + diff.suffix, after);
  }
});
