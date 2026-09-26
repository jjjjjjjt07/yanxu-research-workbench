// Reuses only the named local synthetic project; no model calls.
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
let exp = p.state.experiments.find(
  (e) => e.name === 'Synthetic reproducibility fixture',
);
if (!exp) {
  p = await api(root, {
    action: 'experiment.save',
    revision: p.revision,
    name: 'Synthetic reproducibility fixture',
    filename: 'reproducibility.csv',
    direction: 'higher',
    rows: [{ method: 'A', dataset: 'X', metric: 'accuracy', value: 90 }],
  });
  exp = p.state.experiments.at(-1);
}
assert.ok(
  exp.versions.length <= 7,
  'Fixture needs three remaining version slots',
);
const experimentId = exp.id,
  initialVersion = structuredClone(exp.versions.at(-1));
const priorReview = {
  oldText: p.state.review.oldText,
  newText: p.state.review.newText,
  feedback: p.state.review.feedback,
};
const draft = 'The synthetic run recorded 90.';
const metadata = {
  codeRevision: 'synthetic-commit',
  codeHash: 'A'.repeat(64),
  workingTree: 'modified',
  uncommittedDiff: '+ synthetic test difference',
  inputDataHash: 'b'.repeat(64),
  randomSeed: '42',
  environment: 'synthetic-lock-v1',
  hardware: 'synthetic CPU',
  hyperparameters: 'steps=10',
  dataSplit: 'synthetic train/test split',
  preprocessing: 'none',
  executionTime: '2026-09-15 10:00 +08:00; 1 second',
};
const experiment = () => p.state.experiments.find((e) => e.id === experimentId);
const input = () => ({
  action: 'experiment.reproducibility',
  revision: p.revision,
  id: experimentId,
  versionId: experiment().versions.at(-1).id,
  metadata,
  reason: 'Synthetic run record review.',
});
let observationId, citationId, answerId, exportId;
const observation = () =>
  p.state.observations.find((o) => o.id === observationId);
const cite = () =>
  p.state.review.observationCitations.find((c) => c.id === citationId);
const observeInput = () => ({
  action: 'save',
  id: observationId,
  projectRevision: p.revision,
  graphRevision: g.revision,
  experimentId,
  experimentVersionId: experiment().versions.at(-1).id,
  rowIndices: [0],
  text: 'Synthetic run recorded 90.',
  conditions: 'Synthetic fixture only.',
  outcome: 'inconclusive',
  reason: 'Compare current version.',
});
const citeInput = () => ({
  action: 'cite',
  id: citationId,
  projectRevision: p.revision,
  graphRevision: g.revision,
  observationId,
  manuscriptVersionId: p.state.review.versions.at(-1).id,
  text: draft,
  reason: 'Compare draft with observation.',
});
try {
  await api(
    root,
    { ...input(), metadata: { ...metadata, codeHash: 'not-a-hash' } },
    400,
  );
  await api(
    root,
    { ...input(), metadata: { ...metadata, workingTree: 'clean' } },
    400,
  );
  await api(root, { ...input(), reason: '' }, 400);
  await api(root, { ...input(), id: 'missing' }, 404);
  await api(root, { ...input(), revision: p.revision - 1 }, 409);
  await api(root, { ...input(), versionId: 'old' }, 409);
  await api(root, input(), 401, 'PATCH', false);
  assert.deepEqual((await api(root)).project, p);
  p = (await api(root + '/observations', observeInput())).project;
  observationId = p.state.observations.at(-1).id;
  g = (await api(root + '/graph')).graph;
  p = await api(root, {
    action: 'review.save',
    revision: p.revision,
    oldText: '',
    newText: draft,
    feedback: '',
  });
  p = (await api(root + '/observations', citeInput())).project;
  citationId = p.state.review.observationCitations.at(-1).id;
  g = (await api(root + '/graph')).graph;
  const originalSource = structuredClone(cite().source),
    firstInput = input();
  p = await api(root, firstInput);
  await api(root, firstInput, 409);
  const version = structuredClone(experiment().versions.at(-1));
  assert.deepEqual(
    experiment().versions.find((v) => v.id === initialVersion.id),
    initialVersion,
  );
  assert.deepEqual(version.rows, initialVersion.rows);
  assert.equal(
    version.reproducibility.resultDataHash,
    createHash('sha256')
      .update(JSON.stringify(initialVersion.rows))
      .digest('hex'),
  );
  assert.equal(
    version.reproducibility.metadata.codeHash,
    metadata.codeHash.toLowerCase(),
  );
  assert.equal(version.reproducibility.sourceVersionId, initialVersion.id);
  assert.equal(observation().status, 'stale');
  assert.equal(cite().status, 'stale');
  assert.deepEqual(cite().source, originalSource);
  assert.equal(
    (await api(root + '/graph')).graph.revision,
    g.revision,
    'metadata-only edits do not rewrite the graph',
  );
  p = (await api(root + '/observations', observeInput())).project;
  g = (await api(root + '/graph')).graph;
  assert.equal(
    observation().experiment.reproducibility.metadata.randomSeed,
    '42',
  );
  p = (await api(root + '/observations', citeInput())).project;
  g = (await api(root + '/graph')).graph;
  const paper = p.state.papers.find(
    (p) => p.filename === 'parse-versions-fixture.txt',
  );
  const answer = await api(
    root + '/ai',
    {
      task: 'ask',
      mode: 'excerpts',
      paperIds: [paper.id],
      observationIds: [observationId],
      question: 'Synthetic run provenance?',
    },
    200,
    'POST',
  );
  answerId = answer.savedAnswerId;
  assert.equal(
    answer.observations[0].snapshot.experiment.reproducibility.metadata
      .uncommittedDiff,
    metadata.uncommittedDiff,
  );
  const recorded = (await api(root + '/answers')).records.find(
    (r) => r.id === answerId,
  );
  assert.equal(
    JSON.stringify(recorded.contextSnapshot).includes(metadata.uncommittedDiff),
    false,
  );
  assert.equal(
    recorded.contextSnapshot.experimentObservations[0].experiment
      .reproducibility.metadata.randomSeed,
    '42',
  );
  assert.equal(recorded.status.needsReview, false);
  const source = structuredClone(cite().source);
  p = await api(root, {
    ...input(),
    metadata: { ...metadata, randomSeed: '43' },
    reason: 'Correct synthetic seed.',
  });
  assert.equal(cite().status, 'stale');
  assert.deepEqual(cite().source, source);
  assert.equal(
    (await api(root + '/answers')).records.find((r) => r.id === answerId).status
      .needsReview,
    true,
  );
  assert.deepEqual(
    experiment().versions.find((v) => v.id === version.id),
    version,
  );
  const corrected = structuredClone(experiment().versions.at(-1));
  p = await api(root, {
    action: 'experiment.save',
    revision: p.revision,
    id: experimentId,
    name: exp.name,
    direction: exp.direction,
    filename: initialVersion.filename,
    rows: initialVersion.rows,
  });
  assert.equal(
    experiment().versions.at(-1).reproducibility,
    undefined,
    'new data must not silently inherit an old run record',
  );
  assert.deepEqual(
    experiment().versions.find((v) => v.id === corrected.id),
    corrected,
  );
  const exported = await api(root + '/exports', {}, 201, 'POST');
  exportId = exported.id;
  const bundle = await api(root + '/exports?download=' + exportId);
  const saved = bundle.files.find((f) => f.name === 'project.json').content;
  assert.deepEqual(
    saved.state.experiments.find((e) => e.id === experimentId),
    experiment(),
  );
  assert.deepEqual(
    bundle.files.find((f) => f.name.endsWith('/' + answerId + '.json')).content
      .result,
    recorded.result,
  );
} finally {
  p = (await api(root)).project;
  await api(root, {
    action: 'review.save',
    revision: p.revision,
    ...priorReview,
  });
}
const report = {
  requestsPassed: calls,
  projectId,
  experimentId,
  observationId,
  citationId,
  answerId,
  exportId,
  verifiedAt: new Date().toISOString(),
};
writeFileSync(
  'outputs/v2-validation/reproducibility-api.json',
  JSON.stringify(report, null, 2),
);
console.log(report);
