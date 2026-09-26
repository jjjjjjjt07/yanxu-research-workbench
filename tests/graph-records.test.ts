import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, type Paper } from '../lib/domain.ts';
import { emptyGraph } from '../lib/graph.ts';
import { captureSource, rebindNote } from '../lib/source-reference.ts';
import {
  makeCitationBinding,
  saveCitation,
} from '../lib/manuscript-citations.ts';
import { invalidateEvidenceLinks } from '../lib/evidence-links.ts';

async function fixture() {
  const state = emptyState();
  const paper = { id: 'p', hash: 'document', pages: 1 } as Paper;
  state.papers = [paper];
  const blocks = [{ id: 'b', page: 1, text: 'Method uses Dataset A.' }];
  const source = await captureSource(paper, blocks, 'b');
  source.graphEvidence = { id: 'e', graphRevision: 1 };
  const graph = emptyGraph();
  graph.evidence.push({
    id: 'e',
    paperId: paper.id,
    documentHash: paper.hash,
    parseHash: source.parseHash,
    blockId: 'b',
    page: 1,
    quote: source.quote,
    runId: 'synthetic',
  });
  state.notes.push({
    id: 'n',
    paperId: 'p',
    blockId: 'b',
    text: 'Human observation',
    at: 't1',
    source: structuredClone(source),
  });
  state.review.newText = 'The manuscript uses Dataset A.';
  saveCitation(
    state.review,
    await makeCitationBinding(
      state.review,
      state.review.newText,
      source,
      'human',
      'Compared original',
    ),
  );
  return { state, graph, paper, blocks, source };
}

await test('graph changes invalidate notes and citations once, preserve snapshots, and restoration never re-confirms', async () => {
  const { state, graph } = await fixture();
  const before = structuredClone(state.notes[0]);
  const citation = state.review.citations![0],
    originalCitation = structuredClone(citation);
  const version = state.contextVersion ?? 1;
  graph.revision++;
  assert.equal(
    invalidateEvidenceLinks(state, graph),
    0,
    'unrelated graph revision',
  );
  graph.evidence[0].quote = 'Dataset A';
  assert.equal(invalidateEvidenceLinks(state, graph), 2);
  assert.deepEqual(state.notes[0], { ...before, sourceNeedsReview: true });
  assert.deepEqual(citation, { ...originalCitation, status: 'stale' });
  assert.equal(state.contextVersion, version + 1);
  graph.evidence[0].quote = before.source!.quote;
  assert.equal(invalidateEvidenceLinks(state, graph), 0);
  assert.equal(citation.status, 'stale');
  assert.equal(state.notes[0].sourceNeedsReview, true);
  assert.equal(state.contextVersion, version + 1);
});

await test('missing evidence and changed source coordinates or hashes withdraw validity', async () => {
  for (const key of [
    'missing',
    'paperId',
    'documentHash',
    'parseHash',
    'blockId',
    'page',
  ] as const) {
    const { state, graph } = await fixture();
    if (key === 'missing') graph.evidence = [];
    else if (key === 'page') graph.evidence[0].page++;
    else graph.evidence[0][key] = 'changed';
    assert.equal(invalidateEvidenceLinks(state, graph), 2, key);
  }
});

await test('withdrawal is preserved; explicit direct-source rebind detaches graph and retains old graph references', async () => {
  const { state, graph, paper, blocks } = await fixture();
  const citation = state.review.citations![0];
  citation.status = 'withdrawn';
  graph.evidence = [];
  assert.equal(invalidateEvidenceLinks(state, graph), 1);
  assert.equal(citation.status, 'withdrawn');
  const source = await captureSource(paper, blocks, 'b', 'Dataset A');
  rebindNote(
    state.notes[0],
    source,
    'human',
    't2',
    'Compared original directly',
  );
  saveCitation(
    state.review,
    await makeCitationBinding(
      state.review,
      state.review.newText,
      source,
      'human',
      'Compared directly',
    ),
    citation.id,
  );
  assert.equal(state.notes[0].source?.graphEvidence, undefined);
  assert.equal(
    state.notes[0].sourceHistory?.at(-1)?.source?.graphEvidence?.id,
    'e',
  );
  assert.equal(
    state.review.citations![0].history.at(-1)?.binding.source.graphEvidence?.id,
    'e',
  );
  assert.equal(invalidateEvidenceLinks(state, graph), 0);
  assert.equal(state.review.citations![0].status, 'linked');
});
