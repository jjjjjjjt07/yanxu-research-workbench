import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, type Paper } from '../lib/domain.ts';
import { emptyGraph } from '../lib/graph.ts';
import type { AnswerRecord } from '../lib/answer-history';
import {
  answerEvidenceMatches,
  answerGraphLinks,
  saveAnswerEvidence,
} from '../lib/answer-evidence.ts';
import { invalidateEvidenceLinks } from '../lib/evidence-links.ts';
import { invalidatePaperSources } from '../lib/parse-versions.ts';

function fixture() {
  const state = emptyState();
  state.papers = [{ id: 'p', hash: 'doc', parseVersionId: 'v1' } as Paper];
  const graph = emptyGraph();
  const evidence = {
    id: 'e',
    paperId: 'p',
    documentHash: 'doc',
    parseHash: 'parse',
    blockId: 'b',
    page: 1,
    quote: 'Method uses Dataset A.',
    runId: 'test',
  };
  graph.evidence.push(evidence);
  const source = {
    paperId: 'p',
    documentHash: 'doc',
    parseHash: 'parse',
    parseVersionId: 'v1',
    blockId: 'b',
    page: 1,
    quote: evidence.quote,
  };
  const record = {
    id: 'answer',
    result: {
      sources: [
        {
          paperId: 'p',
          blockId: 'b',
          page: 1,
          quote: source.quote,
          reference: source,
        },
      ],
    },
  } as AnswerRecord;
  const binding = {
    answerId: 'answer',
    sourceIndex: 0,
    source: { ...source, graphEvidence: { id: 'e', graphRevision: 1 } },
    actor: 'human',
    at: 't1',
    reason: 'Compared source',
  };
  return { state, graph, evidence, record, binding };
}

void test('answer association requires exact version, location and quote; missing snapshots are never inferred', () => {
  const { record, evidence } = fixture();
  assert.equal(answerEvidenceMatches(record, 0, evidence), true);
  assert.equal(answerEvidenceMatches(record, 1, evidence), false);
  for (const key of [
    'paperId',
    'documentHash',
    'parseHash',
    'blockId',
    'quote',
  ] as const)
    assert.equal(
      answerEvidenceMatches(record, 0, { ...evidence, [key]: 'changed' }),
      false,
      key,
    );
  assert.equal(
    answerEvidenceMatches(record, 0, { ...evidence, page: 2 }),
    false,
  );
  assert.equal(
    answerEvidenceMatches(record, 0, {
      ...evidence,
      quote: evidence.quote.toLowerCase(),
    }),
    false,
  );
  delete record.result.sources[0].reference;
  assert.equal(answerEvidenceMatches(record, 0, evidence), false);
});

void test('graph corrections preserve historical answers and leave links stale after evidence restoration', () => {
  const { state, graph, record, binding } = fixture();
  const original = structuredClone(record);
  saveAnswerEvidence(state, binding);
  graph.revision++;
  assert.equal(invalidateEvidenceLinks(state, graph), 0);
  const evidence = graph.evidence.pop()!;
  assert.equal(invalidateEvidenceLinks(state, graph), 1);
  assert.equal(answerGraphLinks(state, graph, record.id)[0].status, 'stale');
  graph.evidence.push(evidence);
  assert.equal(invalidateEvidenceLinks(state, graph), 0);
  assert.equal(answerGraphLinks(state, graph, record.id)[0].status, 'stale');
  assert.deepEqual(record, original);
  assert.deepEqual(answerGraphLinks(state, graph, 'other-answer'), []);
});

void test('explicit rebind and withdrawal preserve prior source and actor; parse changes never undo withdrawal', () => {
  const { state, graph, binding } = fixture();
  saveAnswerEvidence(state, binding);
  invalidatePaperSources(state, 'p');
  assert.equal(state.answerEvidenceLinks![0].status, 'stale');
  saveAnswerEvidence(state, {
    ...binding,
    actor: 'second',
    at: 't2',
    reason: 'Rechecked',
  });
  assert.equal(state.answerEvidenceLinks![0].history[0].status, 'stale');
  assert.equal(state.answerEvidenceLinks![0].history[0].actor, 'human');
  saveAnswerEvidence(state, { ...binding, at: 't3', reason: 'Withdraw' }, true);
  invalidatePaperSources(state, 'p');
  graph.evidence = [];
  assert.equal(invalidateEvidenceLinks(state, graph), 0);
  assert.equal(
    answerGraphLinks(state, graph, binding.answerId)[0].status,
    'withdrawn',
  );
  assert.throws(() => saveAnswerEvidence(state, binding, true));
  saveAnswerEvidence(state, {
    ...binding,
    at: 't4',
    reason: 'Explicitly restore',
  });
  assert.equal(
    state.answerEvidenceLinks![0].history.at(-1)?.status,
    'withdrawn',
  );
  assert.equal(state.answerEvidenceLinks!.length, 1);
  assert.equal(
    answerGraphLinks(state, graph, binding.answerId)[0].status,
    'stale',
    'current graph mismatch still surfaced',
  );
});

void test('capacity and required reason reject updates without deleting existing history', () => {
  const { state, binding } = fixture();
  assert.throws(() => saveAnswerEvidence(state, { ...binding, reason: ' ' }));
  const link = saveAnswerEvidence(state, binding);
  link.history = Array.from({ length: 100 }, () => ({
    ...structuredClone(binding),
    status: 'linked',
  }));
  const original = structuredClone(state.answerEvidenceLinks);
  assert.throws(() => saveAnswerEvidence(state, binding));
  assert.deepEqual(state.answerEvidenceLinks, original);
});
