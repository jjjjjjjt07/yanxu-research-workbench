// Only the existing named synthetic fixture; no model calls or real research changes.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error('Local only');
const { projectId } = JSON.parse(
  readFileSync('outputs/v2-validation/parse-versions-fixture-id.json', 'utf8'),
);
const root = `/api/projects/${projectId}`;
let calls = 0;
async function api(
  path,
  body,
  status = 200,
  method = body ? 'PATCH' : 'GET',
  auth = true,
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      ...(auth ? { cookie: '__sites_local_auth=1' } : {}),
      'Content-Type': 'application/json',
      Connection: 'close',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  calls++;
  assert.equal(r.status, status, JSON.stringify(data));
  return data;
}
let { project: p } = await api(root),
  { graph: g } = await api(root + '/graph');
assert.equal(p.question, 'Synthetic parse version verification.');
const graphRevision = g.revision,
  bridge = structuredClone(g.bridges[0]);
assert.ok(bridge);
const evidence = structuredClone(
  g.evidence.find((e) => e.id === bridge.evidenceIds[0]),
);
let experiment = p.state.experiments.find(
  (e) => e.name === 'Synthetic observation fixture',
);
if (!experiment) {
  p = await api(root, {
    action: 'experiment.save',
    revision: p.revision,
    name: 'Synthetic observation fixture',
    direction: 'higher',
    filename: 'synthetic-observation.csv',
    rows: [
      { method: 'A', dataset: 'X', metric: 'accuracy', value: 90 },
      { method: 'B', dataset: 'X', metric: 'accuracy', value: 80 },
    ],
  });
  experiment = p.state.experiments.at(-1);
}
assert.ok(
  experiment.versions.length <= 8,
  'Fixture needs two remaining experiment version slots',
);
const experimentId = experiment.id,
  initial = structuredClone(experiment.versions.at(-1));
const parsing = `${root}/papers/${evidence.paperId}/parsing`;
let s = await api(parsing);
const originalText = s.blocks[0].text,
  parseVersion = s.currentVersionId;
assert.equal(s.hash, evidence.parseHash);
let observationId, exportId;
function input() {
  const current = p.state.experiments.find((e) => e.id === experimentId);
  return {
    action: 'save',
    id: observationId,
    projectRevision: p.revision,
    graphRevision: g.revision,
    experimentId,
    experimentVersionId: current.versions.at(-1).id,
    rowIndices: [0, 1],
    bridgeId: bridge.id,
    text: 'Synthetic expectation: A exceeds B; observed 90 versus 80.',
    conditions: 'Synthetic values; no repeats or significance test.',
    outcome: 'inconclusive',
    reason: 'Compared selected rows and hypothesis.',
  };
}
const currentObservation = () =>
  p.state.observations.find((o) => o.id === observationId);
async function refresh() {
  p = (await api(root)).project;
  g = (await api(root + '/graph')).graph;
}
let dataChanged = false;
try {
  await api(root + '/observations', { ...input(), reason: '' }, 400);
  await api(root + '/observations', { ...input(), conditions: '' }, 400);
  await api(root + '/observations', { ...input(), rowIndices: [0, 0] }, 400);
  await api(root + '/observations', { ...input(), rowIndices: [999] }, 400);
  await api(
    root + '/observations',
    { ...input(), experimentId: 'other-project-experiment' },
    404,
  );
  await api(
    root + '/observations',
    { ...input(), experimentVersionId: 'old' },
    409,
  );
  await api(root + '/observations', { ...input(), bridgeId: 'missing' }, 400);
  await api(
    root + '/observations',
    { ...input(), projectRevision: p.revision - 1 },
    409,
  );
  await api(
    root + '/observations',
    { ...input(), graphRevision: g.revision - 1 },
    409,
  );
  await api(root + '/observations', input(), 401, 'PATCH', false);
  await api(
    '/api/projects/00000000-0000-4000-8000-000000000000/observations',
    input(),
    404,
  );
  assert.deepEqual((await api(root)).project, p);
  assert.deepEqual((await api(root + '/graph')).graph, g);
  const firstInput = input(),
    previousRevision = p.revision;
  p = (await api(root + '/observations', firstInput)).project;
  observationId = p.state.observations.at(-1).id;
  assert.equal(p.revision, previousRevision + 1);
  await api(root + '/observations', firstInput, 409);
  g = (await api(root + '/graph')).graph;
  assert.equal(g.revision, graphRevision + 1);
  assert.deepEqual(
    g.bridges[0],
    bridge,
    'Recording must not promote the hypothesis',
  );
  const originalObservation = structuredClone(currentObservation());
  assert.equal(originalObservation.status, 'recorded');
  assert.deepEqual(
    originalObservation.experiment.rows.map((r) => r.value),
    initial.rows,
  );
  assert.equal(
    originalObservation.experiment.dataHash,
    createHash('sha256').update(JSON.stringify(initial.rows)).digest('hex'),
  );

  g = await api(root + '/graph', {
    action: 'evidence.correct',
    revision: g.revision,
    id: evidence.id,
    quote: 'Dataset A',
    reason: 'Synthetic correction.',
  });
  p = (await api(root)).project;
  assert.deepEqual(currentObservation(), {
    ...originalObservation,
    status: 'stale',
  });
  g = await api(root + '/graph', {
    action: 'graph.restore',
    revision: g.revision,
    targetRevision: graphRevision,
  });
  await refresh();
  assert.equal(currentObservation().status, 'stale');
  p = (await api(root + '/observations', input())).project;
  g = (await api(root + '/graph')).graph;
  assert.equal(currentObservation().history.at(-1).status, 'stale');
  const changedRows = structuredClone(initial.rows);
  changedRows[0].value++;
  p = await api(root, {
    action: 'experiment.save',
    id: experimentId,
    revision: p.revision,
    name: experiment.name,
    direction: experiment.direction,
    filename: initial.filename,
    rows: changedRows,
  });
  dataChanged = true;
  assert.equal(currentObservation().status, 'stale');
  assert.equal(
    currentObservation().experiment.rows[0].value.value,
    initial.rows[0].value,
  );
  await api(
    root + '/observations',
    { ...input(), experimentVersionId: initial.id },
    409,
  );
  p = await api(root, {
    action: 'experiment.save',
    id: experimentId,
    revision: p.revision,
    name: experiment.name,
    direction: experiment.direction,
    filename: initial.filename,
    rows: initial.rows,
  });
  dataChanged = false;
  assert.equal(currentObservation().status, 'stale');
  p = (await api(root + '/observations', input())).project;
  g = (await api(root + '/graph')).graph;
  s = await api(parsing);
  await api(parsing, {
    action: 'correct',
    revision: p.revision,
    hash: s.hash,
    blockId: s.blocks[0].id,
    text: originalText.replace('Dataset A', 'Dataset B'),
    reason: 'Synthetic observation source change.',
  });
  await refresh();
  assert.equal(currentObservation().status, 'stale');
  await api(root + '/observations', input(), 409);
  s = await api(parsing);
  await api(parsing, {
    action: 'restore',
    revision: p.revision,
    hash: s.hash,
    versionId: parseVersion,
    reason: 'Restore original synthetic text.',
  });
  await refresh();
  assert.equal(currentObservation().status, 'stale');
  p = (await api(root + '/observations', input())).project;
  g = (await api(root + '/graph')).graph;
  p = (
    await api(root + '/observations', {
      action: 'withdraw',
      id: observationId,
      projectRevision: p.revision,
      graphRevision: g.revision,
      reason: 'Synthetic withdrawal.',
    })
  ).project;
  g = (await api(root + '/graph')).graph;
  assert.equal(currentObservation().status, 'withdrawn');
  await api(
    root + '/observations',
    {
      action: 'withdraw',
      id: observationId,
      projectRevision: p.revision,
      graphRevision: g.revision,
      reason: 'Duplicate withdrawal.',
    },
    400,
  );
  p = (
    await api(root + '/observations', {
      ...input(),
      bridgeId: undefined,
      reason: 'Explicit recheck without hypothesis association.',
    })
  ).project;
  g = (await api(root + '/graph')).graph;
  assert.equal(currentObservation().hypothesis, undefined);
  assert.equal(
    currentObservation().history.at(-1).hypothesis.snapshot.bridge.id,
    bridge.id,
  );
  assert.equal(currentObservation().history.at(-1).status, 'withdrawn');
  const detached = structuredClone(currentObservation());
  g = await api(root + '/graph', {
    action: 'evidence.correct',
    revision: g.revision,
    id: evidence.id,
    quote: 'Dataset A',
    reason: 'Verify detached observation stays current.',
  });
  p = (await api(root)).project;
  assert.deepEqual(currentObservation(), detached);
  const exp = await api(root + '/exports', {}, 201, 'POST');
  exportId = exp.id;
  const bundle = await api(root + '/exports?download=' + exportId);
  assert.deepEqual(
    bundle.files
      .find((f) => f.name === 'project.json')
      .content.state.observations.find((o) => o.id === observationId),
    detached,
  );
} finally {
  await refresh();
  if (dataChanged)
    p = await api(root, {
      action: 'experiment.save',
      id: experimentId,
      revision: p.revision,
      name: experiment.name,
      direction: experiment.direction,
      filename: initial.filename,
      rows: initial.rows,
    });
  s = await api(parsing);
  if (s.blocks[0].text !== originalText) {
    await api(parsing, {
      action: 'restore',
      revision: p.revision,
      hash: s.hash,
      versionId: parseVersion,
      reason: 'Restore fixture after failed test.',
    });
    await refresh();
  }
  await api(root + '/graph', {
    action: 'graph.restore',
    revision: g.revision,
    targetRevision: graphRevision,
  });
}
const report = {
  requestsPassed: calls,
  projectId,
  experimentId,
  observationId,
  exportId,
  verifiedAt: new Date().toISOString(),
};
writeFileSync(
  'outputs/v2-validation/observations-api.json',
  JSON.stringify(report, null, 2),
);
console.log(report);
