// Local synthetic fixture only. Retains test history; no model calls.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error('Local only');
const { projectId } = JSON.parse(
  readFileSync('outputs/v2-validation/parse-versions-fixture-id.json', 'utf8'),
);
const root = `/api/projects/${projectId}`,
  headers = {
    cookie: '__sites_local_auth=1',
    'Content-Type': 'application/json',
    Connection: 'close',
  };
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
    headers: auth
      ? headers
      : { 'Content-Type': 'application/json', Connection: 'close' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  calls++;
  assert.equal(response.status, status, JSON.stringify(result));
  return result;
}
let { project: p } = await api(root);
assert.equal(p.question, 'Synthetic parse version verification.');
let exp = p.state.experiments.find(
  (e) => e.name === 'Synthetic CSV source fixture',
);
assert.ok(
  exp ? exp.versions.length <= 7 : p.state.experiments.length < 5,
  'Needs three version slots or one experiment slot',
);
const originalExperiments = structuredClone(p.state.experiments);
const raw = Buffer.from(
  '\uFEFFmethod,dataset,metric,value,comment\r\n\r\n"A, quoted",X,accuracy,90,"first\r\nsecond"\r\nB,X,accuracy,80,extra\r\n',
);
const input = {
  revision: p.revision,
  ...(exp ? { id: exp.id } : {}),
  name: 'Synthetic CSV source fixture',
  filename: 'synthetic-原件.csv',
  direction: 'higher',
  origin: 'file',
  base64: raw.toString('base64'),
};
const endpoint = root + '/experiments';
await api(endpoint, { ...input, base64: 'broken!' }, 400, 'POST');
await api(
  endpoint,
  {
    ...input,
    base64: Buffer.from('method,dataset,metric,value\nA,X,m,').toString(
      'base64',
    ),
  },
  400,
  'POST',
);
await api(
  endpoint,
  { ...input, base64: Buffer.from([255, 254, 0, 65]).toString('base64') },
  400,
  'POST',
);
await api(
  endpoint,
  { ...input, base64: Buffer.alloc(1_000_001).toString('base64') },
  400,
  'POST',
);
await api(endpoint, { ...input, revision: p.revision - 1 }, 409, 'POST');
await api(endpoint, { ...input, id: 'missing' }, 400, 'POST');
await api(endpoint, { ...input, rows: [{ value: 999 }] }, 400, 'POST');
await api(endpoint, input, 401, 'POST', false);
assert.deepEqual(
  (await api(root)).project,
  p,
  'Rejected requests must not change the project',
);
p = await api(endpoint, input, 201, 'POST');
await api(endpoint, input, 409, 'POST');
exp = p.state.experiments.find((e) => e.name === input.name);
const experimentId = exp.id,
  v1 = structuredClone(exp.versions.at(-1));
assert.deepEqual(v1.csvSource.lineRanges, [
  [3, 4],
  [5, 5],
]);
assert.equal(
  v1.csvSource.sha256,
  createHash('sha256').update(raw).digest('hex'),
);
assert.equal(v1.csvSource.size, raw.length);
assert.equal(v1.rows[0].value, 90);
assert.equal('comment' in v1.rows[0], false);
for (const old of originalExperiments) {
  const current = p.state.experiments.find((e) => e.id === old.id);
  assert.deepEqual(
    current.versions.slice(0, old.versions.length),
    old.versions,
  );
}
const downloadPath = (versionId, id = experimentId) =>
  endpoint + `?experimentId=${id}&versionId=${versionId}`;
async function download(versionId, expected) {
  const response = await fetch(base + downloadPath(versionId), { headers });
  calls++;
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /^attachment;/);
  assert.equal(
    response.headers.get('x-content-sha256'),
    createHash('sha256').update(expected).digest('hex'),
  );
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected);
}
await download(v1.id, raw);
await api(downloadPath(v1.id), undefined, 401, 'GET', false);
await api(downloadPath(v1.id, 'missing'), undefined, 404);
await api(downloadPath('missing'), undefined, 404);
const legacy = originalExperiments
  .flatMap((e) => e.versions.map((v) => ({ e, v })))
  .find((x) => !x.v.csvSource);
if (legacy) await api(downloadPath(legacy.v.id, legacy.e.id), undefined, 404);
const { graph: g } = await api(root + '/graph');
p = (
  await api(root + '/observations', {
    action: 'save',
    projectRevision: p.revision,
    graphRevision: g.revision,
    experimentId,
    experimentVersionId: v1.id,
    rowIndices: [0],
    text: 'Synthetic CSV observation: 90.',
    conditions: 'Synthetic source retention only.',
    outcome: 'inconclusive',
    reason: 'Verify exact source row.',
  })
).project;
const observationId = p.state.observations.at(-1).id;
const snapshot = structuredClone(p.state.observations.at(-1).experiment);
assert.deepEqual(snapshot.rows[0].sourceRow, {
  id: v1.csvSource.id + ':1',
  startLine: 3,
  endLine: 4,
});
assert.equal(snapshot.csvSource.sha256, v1.csvSource.sha256);
assert.equal('lineRanges' in snapshot.csvSource, false);
p = await api(root, {
  action: 'experiment.reproducibility',
  revision: p.revision,
  id: experimentId,
  versionId: v1.id,
  metadata: { randomSeed: '42' },
  reason: 'Synthetic metadata correction.',
});
exp = p.state.experiments.find((e) => e.id === experimentId);
const v2 = structuredClone(exp.versions.at(-1));
assert.deepEqual(v2.csvSource, v1.csvSource);
assert.equal(
  p.state.observations.find((o) => o.id === observationId).status,
  'stale',
);
assert.deepEqual(
  p.state.observations.find((o) => o.id === observationId).experiment,
  snapshot,
);
await download(v2.id, raw);
const edited = Buffer.from('method,dataset,metric,value\nA,X,accuracy,91\n');
p = await api(
  endpoint,
  {
    ...input,
    id: experimentId,
    revision: p.revision,
    origin: 'text',
    filename: '手动输入.csv',
    base64: edited.toString('base64'),
  },
  201,
  'POST',
);
exp = p.state.experiments.find((e) => e.id === experimentId);
const v3 = exp.versions.at(-1);
assert.equal(v3.csvSource.origin, 'text');
assert.notEqual(v3.csvSource.id, v1.csvSource.id);
assert.equal(v3.reproducibility, undefined);
assert.deepEqual(
  exp.versions.find((v) => v.id === v1.id),
  v1,
);
assert.deepEqual(
  exp.versions.find((v) => v.id === v2.id),
  v2,
);
await download(v3.id, edited);
await download(v1.id, raw);
const exported = await api(root + '/exports', {}, 201, 'POST');
const bundle = await api(root + '/exports?download=' + exported.id);
for (const [source, expected] of [
  [v1.csvSource, raw],
  [v3.csvSource, edited],
]) {
  const copies = bundle.files.filter(
    (f) => f.name === `experiments/${source.id}.json`,
  );
  assert.equal(
    copies.length,
    1,
    'Repeated metadata versions share one original file',
  );
  const file = copies[0];
  assert.equal(
    file.sha256,
    createHash('sha256').update(JSON.stringify(file.content)).digest('hex'),
  );
  assert.deepEqual(Buffer.from(file.content.base64, 'base64'), expected);
  assert.equal(file.content.sha256, source.sha256);
}
assert.deepEqual(
  bundle.files.find((f) => f.name === 'project.json').content.state.experiments,
  p.state.experiments,
);
const result = {
  requestsPassed: calls,
  projectId,
  experimentId,
  observationId,
  sourceIds: [v1.csvSource.id, v3.csvSource.id],
  exportId: exported.id,
  verifiedAt: new Date().toISOString(),
};
writeFileSync(
  'outputs/v2-validation/experiment-csv-api.json',
  JSON.stringify(result, null, 2) + '\n',
);
console.log(JSON.stringify(result));
