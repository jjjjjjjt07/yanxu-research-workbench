import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyGraph } from '../lib/graph.ts';
import {
  emptyState,
  ensureCells,
  cellSnapshot,
  editCell,
} from '../lib/domain.ts';
import { invalidateEvidenceLinks } from '../lib/evidence-links.ts';

void test('source corrections withdraw validity, preserve values/history and do not touch unrelated cells', () => {
  const p = { state: emptyState() };
  p.state.papers.push({
    id: 'paper',
    title: 'test',
    filename: 'test',
    pages: 1,
    hash: 'doc',
    kind: 'text',
    sample: false,
    blockCount: 1,
    importedAt: '',
  });
  ensureCells(p.state);
  const cell = p.state.cells[0];
  const evidence = {
    id: 'e',
    paperId: 'paper',
    documentHash: 'doc',
    parseHash: 'parse',
    blockId: 'b',
    page: 1,
    quote: 'Original source.',
    runId: 'test',
  };
  const g = { ...emptyGraph(), evidence: [evidence] };
  Object.assign(cell, {
    value: 'Kept human value',
    quote: evidence.quote,
    blockId: 'b',
    page: 1,
    sourceValid: true,
    status: 'confirmed',
    evidenceRef: {
      id: 'e',
      graphRevision: 1,
      documentHash: 'doc',
      parseHash: 'parse',
    },
  });
  cell.candidate = cellSnapshot(cell);
  assert.equal(invalidateEvidenceLinks(p.state, g), 0);
  const unrelated = JSON.stringify(p.state.cells.slice(1));
  evidence.quote = 'Corrected source.';
  assert.equal(invalidateEvidenceLinks(p.state, g), 2);
  assert.equal(cell.value, 'Kept human value');
  assert.equal(cell.status, 'stale');
  assert.equal(cell.history[0].value.sourceValid, true);
  assert.equal(cell.history[0].value.evidenceRef?.id, 'e');
  assert.equal(cell.candidate.sourceValid, false);
  assert.equal(JSON.stringify(p.state.cells.slice(1)), unrelated);
  assert.equal(invalidateEvidenceLinks(p.state, g), 0);
  evidence.quote = 'Original source.';
  assert.equal(invalidateEvidenceLinks(p.state, g), 0);
  assert.equal(cell.status, 'stale');
});

void test('manual replacement of a source detaches current linkage but retains the historical reference', () => {
  const p = { state: emptyState() };
  p.state.papers.push({
    id: 'paper',
    title: 'test',
    filename: 'test',
    pages: 1,
    hash: 'doc',
    kind: 'text',
    sample: false,
    blockCount: 1,
    importedAt: '',
  });
  ensureCells(p.state);
  const cell = p.state.cells[0];
  cell.evidenceRef = {
    id: 'e',
    graphRevision: 1,
    documentHash: 'doc',
    parseHash: 'parse',
  };
  editCell(
    p.state,
    cell.id,
    {
      value: 'new',
      quote: 'New source.',
      blockId: 'b',
      reason: 'Human review',
    },
    [{ id: 'b', page: 1, text: 'New source.' }],
  );
  assert.equal(cell.evidenceRef, undefined);
  assert.equal(cell.history[0].value.evidenceRef?.id, 'e');
});
