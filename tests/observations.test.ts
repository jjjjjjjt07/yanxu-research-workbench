import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, type Experiment, type Paper } from '../lib/domain.ts';
import { emptyGraph } from '../lib/graph.ts';
import {
  captureExperiment,
  bridgeSnapshot,
  saveObservation,
  withdrawObservation,
  invalidateExperimentObservations,
  invalidateObservationGraph,
} from '../lib/observations.ts';
import { invalidatePaperSources } from '../lib/parse-versions.ts';

async function fixture() {
  const state = emptyState();
  state.papers.push({ id: 'p', hash: 'doc' } as Paper);
  const experiment: Experiment = {
    id: 'exp',
    name: 'test',
    direction: 'higher',
    versions: [
      {
        id: 'v1',
        filename: 'test.csv',
        at: 't1',
        rows: [
          { method: 'A', dataset: 'X', metric: 'accuracy', value: 90 },
          { method: 'B', dataset: 'X', metric: 'accuracy', value: 80 },
        ],
      },
    ],
  };
  state.experiments.push(experiment);
  const graph = emptyGraph();
  graph.entities = ['a', 'b'].map((id) => ({
    id,
    name: id,
    type: 'method',
    domain: '',
    aliases: [],
    definition: '',
    paperIds: ['p'],
  }));
  graph.evidence = [
    {
      id: 'e',
      paperId: 'p',
      documentHash: 'doc',
      parseHash: 'parse',
      blockId: 'b',
      page: 1,
      quote: 'Original source.',
      runId: 'test',
    },
  ];
  graph.bridges = [
    {
      id: 'bridge',
      source: 'a',
      target: 'b',
      evidenceIds: ['e'],
      relationIds: [],
      question: 'Does this transfer?',
      status: 'candidate',
      mapping: 'Synthetic mapping',
      differences: 'Synthetic conditions',
      risks: 'Unknown transfer',
      experiment: 'Compare A and B',
      kind: 'transfer',
      reason: 'Synthetic fixture',
      contextHash: 'context',
      runId: 'test',
    },
  ];
  const value = {
    text: 'Observed difference; no statistical test.',
    conditions: 'Synthetic data only',
    outcome: 'inconclusive' as const,
    experiment: await captureExperiment(experiment, 'v1', [1, 0]),
    hypothesis: { graphRevision: 1, snapshot: bridgeSnapshot(graph, 'bridge') },
    actor: 'human',
    at: 't1',
    reason: 'Compared data',
  };
  return { state, graph, experiment, value };
}
await test('observation captures selected rows and whole-version hash; rejects duplicate, invalid or old-version selections', async () => {
  const { value, experiment } = await fixture();
  assert.deepEqual(
    value.experiment.rows.map((r) => r.index),
    [0, 1],
  );
  assert.equal(value.experiment.dataHash.length, 64);
  experiment.versions[0].rows[0].value = 0;
  assert.equal(value.experiment.rows[0].value.value, 90);
  for (const indices of [[], [0, 0], [-1], [2], [0.5]])
    await assert.rejects(captureExperiment(experiment, 'v1', indices));
  await assert.rejects(captureExperiment(experiment, 'old', [0]));
});
await test('graph invalidation preserves observations and never confirms hypotheses or restores validity automatically', async () => {
  const { state, graph, value } = await fixture();
  const o = saveObservation(state, value),
    before = structuredClone(o);
  assert.equal(graph.bridges[0].status, 'candidate');
  graph.revision++;
  assert.equal(invalidateObservationGraph(state, graph), 0);
  graph.evidence[0].quote = 'Corrected source.';
  assert.equal(invalidateObservationGraph(state, graph), 1);
  assert.deepEqual(o, { ...before, status: 'stale' });
  graph.evidence[0].quote = 'Original source.';
  assert.equal(invalidateObservationGraph(state, graph), 0);
  assert.equal(o.status, 'stale');
  const updated = saveObservation(
    state,
    { ...value, reason: 'Explicit recheck' },
    o.id,
  );
  assert.equal(updated.status, 'recorded');
  assert.equal(updated.history[0].status, 'stale');
});
await test('hypothesis edits, entity corrections, missing evidence and document changes invalidate associated observations', async () => {
  for (const change of ['bridge', 'entity', 'missing', 'document']) {
    const { state, graph, value } = await fixture();
    saveObservation(state, value);
    if (change === 'bridge') graph.bridges[0].question = 'Changed hypothesis';
    if (change === 'entity') graph.entities[0].definition = 'Changed meaning';
    if (change === 'missing') graph.evidence = [];
    if (change === 'document') state.papers[0].hash = 'changed';
    assert.equal(invalidateObservationGraph(state, graph), 1, change);
  }
});
await test('experiment and parse updates preserve snapshots, while withdrawal remains withdrawn; unlinking keeps prior hypothesis history', async () => {
  const { state, graph, value } = await fixture();
  const o = saveObservation(state, value);
  invalidateExperimentObservations(state, 'other');
  assert.equal(o.status, 'recorded');
  invalidateExperimentObservations(state, 'exp');
  assert.equal(o.status, 'stale');
  let current = saveObservation(state, value, o.id);
  invalidatePaperSources(state, 'p');
  assert.equal(current.status, 'stale');
  withdrawObservation(state, o.id, 'human2', 't2', 'Withdraw');
  invalidateExperimentObservations(state, 'exp');
  assert.equal(current.status, 'withdrawn');
  const { hypothesis: _hypothesis, ...unlinked } = value;
  current = saveObservation(state, unlinked, o.id);
  assert.equal(
    current.history.at(-1)?.hypothesis?.snapshot.bridge.id,
    'bridge',
  );
  assert.equal(current.history.at(-1)?.status, 'withdrawn');
  graph.evidence = [];
  assert.equal(invalidateObservationGraph(state, graph), 0);
  assert.equal(current.hypothesis, undefined);
  assert.equal(state.observations!.length, 1);
});
