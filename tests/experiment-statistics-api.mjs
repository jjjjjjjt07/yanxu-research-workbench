// Uses only the existing synthetic CSV fixture; retains three new versions.
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
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(auth ? { cookie: '__sites_local_auth=1' } : {}),
      'Content-Type': 'application/json',
      Connection: 'close',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  calls++;
  assert.equal(response.status, status, JSON.stringify(result));
  return result;
}
let { project: p } = await api(root);
assert.equal(p.question, 'Synthetic parse version verification.');
const exp = p.state.experiments.find(
  (e) => e.name === 'Synthetic CSV source fixture',
);
assert.ok(
  exp && exp.versions.length <= 7,
  'Existing CSV fixture must have three version slots',
);
const experimentId = exp.id,
  before = structuredClone(exp.versions);
const header = 'method,dataset,metric,value,runId\n';
const text =
  header +
  'A,X,accuracy,80,run-1\nA,X,accuracy,100,run-2\nB,X,accuracy,85,run-1\nB,X,accuracy,95,run-2\nA,Y,accuracy,7,run-1\n';
const input = {
  revision: p.revision,
  id: experimentId,
  name: exp.name,
  filename: 'synthetic-runs.csv',
  direction: 'higher',
  origin: 'file',
  base64: Buffer.from(text).toString('base64'),
};
const endpoint = root + '/experiments';
for (const invalid of [
  header + 'A,X,accuracy,1,r1\nA,X,accuracy,2,r1',
  header + 'A,X,accuracy,1,r1\nA,X,accuracy,2,',
  header + 'A,X,accuracy,1,' + 'r'.repeat(81),
])
  await api(
    endpoint,
    { ...input, base64: Buffer.from(invalid).toString('base64') },
    400,
    'POST',
  );
await api(endpoint, { ...input, revision: p.revision - 1 }, 409, 'POST');
await api(endpoint, input, 401, 'POST', false);
await api(
  root,
  {
    action: 'experiment.save',
    revision: p.revision,
    id: experimentId,
    name: exp.name,
    filename: 'invalid.json',
    direction: 'higher',
    rows: [
      { method: 'A', dataset: 'X', metric: 'accuracy', value: 1, runId: '' },
    ],
  },
  400,
);
assert.deepEqual((await api(root)).project, p);
p = await api(endpoint, input, 201, 'POST');
await api(endpoint, input, 409, 'POST');
const current = () => p.state.experiments.find((e) => e.id === experimentId);
const v1 = structuredClone(current().versions.at(-1));
assert.deepEqual(current().versions.slice(0, before.length), before);
assert.equal(v1.csvSource.parser, 'papaparse-5.7.0/comma-runs-v2');
assert.equal(v1.statistics.groups.length, 3);
assert.equal(v1.statistics.groups[0].n, 2);
assert.equal(v1.statistics.groups[0].mean, 90);
assert.equal(v1.statistics.groups[0].sampleSD, Math.sqrt(200));
assert.equal(v1.statistics.groups[2].sampleSD, null);
assert.equal(v1.statistics.groups[2].issue, 'single_value');
assert.deepEqual(v1.statistics.groups[0].runIds, ['run-1', 'run-2']);
assert.equal(
  v1.statistics.inputDataHash,
  createHash('sha256').update(JSON.stringify(v1.rows)).digest('hex'),
);
p = await api(root, {
  action: 'claim.add',
  revision: p.revision,
  experimentId,
  text: 'Synthetic repeated result requires a chosen statistic.',
  method: 'A',
  otherMethod: 'B',
  dataset: 'X',
  metric: 'accuracy',
  relation: 'higher',
  expected: null,
});
const claimId = p.state.claims.at(-1).id;
assert.equal(p.state.claims.at(-1).result, 'missing');
await api(
  root,
  { action: 'claim.confirm', revision: p.revision, id: claimId },
  400,
);
const { graph: g } = await api(root + '/graph');
p = (
  await api(root + '/observations', {
    action: 'save',
    projectRevision: p.revision,
    graphRevision: g.revision,
    experimentId,
    experimentVersionId: v1.id,
    rowIndices: [0, 1],
    text: 'Synthetic runs range from 80 to 100.',
    conditions: 'Same synthetic dataset and metric; independence not assessed.',
    outcome: 'inconclusive',
    reason: 'Verify per-run source snapshot.',
  })
).project;
const observationId = p.state.observations.at(-1).id,
  snapshot = structuredClone(p.state.observations.at(-1).experiment);
assert.deepEqual(
  snapshot.rows.map((r) => r.value.runId),
  ['run-1', 'run-2'],
);
assert.deepEqual(
  snapshot.rows.map((r) => r.sourceRow.startLine),
  [2, 3],
);
p = await api(root, {
  action: 'experiment.reproducibility',
  revision: p.revision,
  id: experimentId,
  versionId: v1.id,
  metadata: { randomSeed: 'run-1: 42; run-2: 43' },
  reason: 'Record seeds for synthetic runs.',
});
const v2 = structuredClone(current().versions.at(-1));
assert.deepEqual(v2.statistics, v1.statistics);
assert.equal(
  p.state.observations.find((o) => o.id === observationId).status,
  'stale',
);
const changed = text + 'A,X,accuracy,90,run-3\n';
p = await api(
  endpoint,
  {
    ...input,
    revision: p.revision,
    base64: Buffer.from(changed).toString('base64'),
  },
  201,
  'POST',
);
const v3 = structuredClone(current().versions.at(-1));
assert.equal(v3.statistics.groups[0].n, 3);
assert.equal(v3.statistics.groups[0].mean, 90);
assert.equal(v3.statistics.groups[0].sampleSD, 10);
assert.deepEqual(v3.statistics.groups[0].indices, [0, 1, 5]);
assert.notEqual(v3.statistics.inputDataHash, v1.statistics.inputDataHash);
assert.deepEqual(
  current().versions.find((v) => v.id === v1.id),
  v1,
);
assert.deepEqual(
  current().versions.find((v) => v.id === v2.id),
  v2,
);
assert.deepEqual(
  p.state.observations.find((o) => o.id === observationId).experiment,
  snapshot,
);
assert.equal(p.state.claims.find((c) => c.id === claimId).needsReview, true);
assert.equal(p.state.claims.find((c) => c.id === claimId).result, 'missing');
const saved = (await api(root)).project;
assert.deepEqual(
  saved.state.experiments.find((e) => e.id === experimentId),
  current(),
);
const exported = await api(root + '/exports', {}, 201, 'POST');
const bundle = await api(root + '/exports?download=' + exported.id);
const exportedExperiment = bundle.files
  .find((f) => f.name === 'project.json')
  .content.state.experiments.find((e) => e.id === experimentId);
assert.deepEqual(exportedExperiment, current());
for (const [v, raw] of [
  [v1, text],
  [v3, changed],
]) {
  const source = bundle.files.find(
    (f) => f.name === `experiments/${v.csvSource.id}.json`,
  ).content;
  assert.equal(Buffer.from(source.base64, 'base64').toString('utf8'), raw);
  assert.deepEqual(source.lineRanges, v.csvSource.lineRanges);
}
const report = {
  requestsPassed: calls,
  projectId,
  experimentId,
  versionId: v3.id,
  observationId,
  claimId,
  exportId: exported.id,
  verifiedAt: new Date().toISOString(),
};
writeFileSync(
  'outputs/v2-validation/experiment-statistics-api.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report));
