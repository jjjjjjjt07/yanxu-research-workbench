import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, type Project } from '../lib/domain.ts';
import { emptyGraph } from '../lib/graph.ts';
import {
  captureExperiment,
  saveObservation,
  withdrawObservation,
  invalidateExperimentObservations,
} from '../lib/observations.ts';
import {
  captureObservationReference,
  observationContext,
  observationReferenceCurrent,
  validateObservationIndices,
} from '../lib/observation-reference.ts';
import {
  saveObservationCitation,
  withdrawObservationCitation,
  invalidateObservationCitations,
} from '../lib/observation-citations.ts';
import { saveManuscript } from '../lib/manuscript.ts';
import { researchContext } from '../lib/research-context.ts';
import { qualifiedSupport } from '../lib/reading-answer.ts';
async function fixture() {
  const state = emptyState();
  state.experiments.push({
    id: 'exp',
    name: 'Test',
    direction: 'higher',
    versions: [
      {
        id: 'v1',
        at: 't1',
        filename: 'test.csv',
        rows: [{ method: 'A', dataset: 'X', metric: 'accuracy', value: 90 }],
      },
    ],
  });
  const value = {
    text: 'Observed 90',
    conditions: 'Synthetic single run',
    outcome: 'inconclusive' as const,
    experiment: await captureExperiment(state.experiments[0], 'v1', [0]),
    actor: 'human',
    at: 't1',
    reason: 'Compared data',
  };
  const o = saveObservation(state, value);
  const graph = emptyGraph();
  const reference = await captureObservationReference(state, graph, o.id);
  return { state, o, value, reference, graph };
}
await test('question context includes only selected current observations, with no histories or literature evidence', async () => {
  const { state, o } = await fixture();
  const project = { state, title: 'Test', question: 'Compare' } as Project;
  assert.equal(
    'experimentObservations' in researchContext(project),
    false,
    'old context hashes stay compatible',
  );
  const context = observationContext(state, [o.id]);
  assert.equal(context[0].text, 'Observed 90');
  assert.equal('history' in context[0], false);
  assert.equal('hypothesis' in context[0], false);
  o.status = 'stale';
  assert.deepEqual(observationContext(state, [o.id]), [
    { id: o.id, status: 'stale' },
  ]);
  o.status = 'withdrawn';
  assert.equal(observationContext(state, [o.id])[0].text, undefined);
});
await test('observation references are immutable and cannot freshen after edit, withdrawal or equal-data restoration', async () => {
  const { state, o, value, reference, graph } = await fixture();
  assert.equal(observationReferenceCurrent(state, reference), true);
  saveObservation(state, { ...value, text: 'Revised interpretation' }, o.id);
  assert.equal(observationReferenceCurrent(state, reference), false);
  assert.equal(reference.snapshot.text, 'Observed 90');
  withdrawObservation(state, o.id, 'human', 't2', 'Withdraw');
  await assert.rejects(captureObservationReference(state, graph, o.id));
  saveObservation(state, value, o.id);
  state.experiments[0].versions.push({
    ...state.experiments[0].versions[0],
    id: 'v2',
  });
  invalidateExperimentObservations(state, 'exp');
  assert.equal(observationReferenceCurrent(state, reference), false);
  await assert.rejects(captureObservationReference(state, graph, o.id));
});
await test('observation manuscript citations preserve both snapshots and remain stale after version restoration', async () => {
  const { state, reference, value, o, graph } = await fixture();
  saveManuscript(
    state.review,
    { oldText: '', newText: 'A achieved 90 in our experiment.', feedback: '' },
    'human',
  );
  await assert.rejects(
    saveObservationCitation(
      state,
      reference,
      'Invented sentence',
      'human',
      'Review',
    ),
  );
  await saveObservationCitation(
    state,
    reference,
    state.review.newText,
    'human',
    'Compared result',
  );
  const c = state.review.observationCitations![0];
  saveObservation(state, { ...value, conditions: 'Changed conditions' }, o.id);
  invalidateObservationCitations(state);
  assert.equal(c.status, 'stale');
  assert.equal(c.source.snapshot.conditions, 'Synthetic single run');
  const updated = await captureObservationReference(state, graph, o.id);
  await saveObservationCitation(
    state,
    updated,
    state.review.newText,
    'human',
    'Rechecked',
    c.id,
  );
  assert.equal(c.history[0].status, 'stale');
  saveManuscript(
    state.review,
    {
      oldText: '',
      newText: 'A achieved 90 in our experiment.',
      feedback: 'New feedback',
    },
    'human',
  );
  assert.equal(c.status, 'stale');
  await saveObservationCitation(
    state,
    updated,
    state.review.newText,
    'human',
    'Rechecked new draft',
    c.id,
  );
  withdrawObservationCitation(state, c.id, 'human', 'Withdraw citation');
  invalidateObservationCitations(state);
  assert.equal(c.status, 'withdrawn');
  assert.throws(() =>
    withdrawObservationCitation(state, c.id, 'human', 'Again'),
  );
  await saveObservationCitation(
    state,
    updated,
    state.review.newText,
    'human',
    'Explicit restore',
    c.id,
  );
  assert.equal(c.history.at(-1)?.status, 'withdrawn');
});
void test('model observation references reject invented, fractional and duplicate indices', () => {
  assert.deepEqual(validateObservationIndices([0], 1), {
    valid: true,
    indices: [0],
  });
  for (const indices of [[1], [-1], [0.5], [0, 0]])
    assert.equal(validateObservationIndices(indices, 1).valid, false);
  assert.deepEqual(validateObservationIndices([], 0), {
    valid: true,
    indices: [],
  });
});
void test('model support cannot certify unknowns, unchecked calculations, inferences or user observations', () => {
  assert.equal(qualifiedSupport('unknown', 'supported', false), 'unknown');
  assert.equal(qualifiedSupport('inference', 'supported', false), 'partial');
  assert.equal(qualifiedSupport('calculation', 'supported', false), 'partial');
  assert.equal(qualifiedSupport('fact', 'supported', true), 'partial');
  assert.equal(qualifiedSupport('fact', 'supported', false), 'supported');
  assert.equal(qualifiedSupport('inference', 'conflict', true), 'conflict');
});
