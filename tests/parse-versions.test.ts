import test from 'node:test';
import assert from 'node:assert/strict';
import {
  correctBlock,
  parseFileSuffix,
  invalidatePaperSources,
  invalidateGraphParses,
} from '../lib/parse-versions.ts';
import { emptyGraph } from '../lib/graph.ts';
import type { ProjectState, Paper } from '../lib/domain';

void test('correction retains source IDs, geometry, other blocks and original data; bounds reject rather than truncate', () => {
  const blocks = [
    { id: 'a', page: 1, text: 'old', rect: [1, 2, 3, 4] },
    { id: 'b', page: 2, text: 'untouched' },
  ];
  const next = correctBlock(blocks, 'a', 'corrected');
  assert.equal(blocks[0].text, 'old');
  assert.equal(next[0].text, 'corrected');
  assert.deepEqual(next[0].rect, blocks[0].rect);
  assert.deepEqual(next[1], blocks[1]);
  assert.throws(() => correctBlock(blocks, 'unknown', 'value'));
  assert.throws(() => correctBlock(blocks, 'a', ' '));
  assert.throws(() => correctBlock(blocks, 'a', 'x'.repeat(6001)));
  assert.equal(parseFileSuffix('original'), 'blocks.json');
  assert.throws(() => parseFileSuffix('../raw'));
});
void test('source invalidation preserves manual value and audit, withdraws candidate validity, flags referenced notes only', () => {
  const state = {
    cells: [
      {
        id: 'c',
        paperId: 'p',
        value: 'manual value',
        blockId: 'a',
        quote: 'old',
        status: 'confirmed',
        sourceValid: true,
        history: [],
        candidate: { sourceValid: true, note: 'candidate' },
      },
    ],
    notes: [
      { paperId: 'p', blockId: 'a', text: 'keep' },
      { paperId: 'p', blockId: '', text: 'unlinked' },
    ],
  } as unknown as ProjectState;
  invalidatePaperSources(state, 'p');
  assert.equal(state.cells[0].value, 'manual value');
  assert.equal(state.cells[0].status, 'stale');
  assert.equal(state.cells[0].history[0].status, 'confirmed');
  assert.equal(state.cells[0].candidate?.sourceValid, false);
  assert.equal(state.notes[0].sourceNeedsReview, true);
  assert.equal(state.notes[1].sourceNeedsReview, undefined);
  invalidatePaperSources(state, 'p');
  assert.equal(state.cells[0].history.length, 1);
});
void test('restoring an old graph cannot re-confirm evidence from a different active parse', () => {
  const graph = emptyGraph();
  graph.evidence = [
    { id: 'e', paperId: 'p', parseHash: 'old' },
  ] as typeof graph.evidence;
  graph.relations = [
    { id: 'r', evidenceIds: ['e'], status: 'confirmed' },
    { id: 'rejected', evidenceIds: ['e'], status: 'rejected' },
  ] as typeof graph.relations;
  graph.bridges = [
    { id: 'bridge', evidenceIds: [], relationIds: ['r'], status: 'tried' },
  ] as unknown as typeof graph.bridges;
  invalidateGraphParses(graph, [
    { id: 'p', parsing: { hash: 'new' } },
  ] as Paper[]);
  assert.deepEqual(
    graph.relations.map((r) => r.status),
    ['stale', 'rejected'],
  );
  assert.equal(graph.bridges[0].status, 'stale');
  assert.equal(graph.evidence[0].parseHash, 'old');
});
