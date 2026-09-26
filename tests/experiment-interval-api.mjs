// Existing synthetic repeated-run fixture only; no model calls, one new data version.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
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
let { project: p } = await api(root);
assert.equal(p.question, 'Synthetic parse version verification.');
const exp = p.state.experiments.find(
  (e) => e.name === 'Synthetic CSV source fixture',
);
assert.ok(
  exp && exp.versions.length < 10,
  'Requires one experiment version slot',
);
const experimentId = exp.id,
  initialVersion = structuredClone(exp.versions.at(-1));
assert.deepEqual(
  initialVersion.rows
    .filter((r) => r.method === 'A' && r.dataset === 'X')
    .map((r) => r.value),
  [80, 100, 90],
);
const current = () => p.state.experiments.find((e) => e.id === experimentId);
const assumptions = {
  unit: 'accuracy points',
  samplingUnit: 'one separately generated synthetic run',
  conditions: 'Synthetic fixed setup only',
  independent: true,
  independenceBasis: 'independent simulated runs; test fixture only',
  approximateNormal: true,
  distributionBasis:
    'assumed synthetic normal generator; not assessed on research data',
};
const input = () => ({
  action: 'experiment.interval',
  revision: p.revision,
  id: experimentId,
  versionId: current().versions.at(-1).id,
  method: 'A',
  dataset: 'X',
  metric: 'accuracy',
  assumptions,
  reason: 'Synthetic interval workflow check.',
});
await api(
  root,
  { ...input(), assumptions: { ...assumptions, independent: false } },
  400,
);
await api(
  root,
  { ...input(), assumptions: { ...assumptions, approximateNormal: false } },
  400,
);
await api(root, { ...input(), assumptions: { ...assumptions, unit: '' } }, 400);
await api(
  root,
  { ...input(), assumptions: { ...assumptions, distributionBasis: '' } },
  400,
);
await api(root, { ...input(), reason: ' ' }, 400);
await api(root, { ...input(), method: 'missing' }, 400);
await api(root, { ...input(), dataset: 'Y' }, 400);
await api(root, { ...input(), id: 'missing' }, 404);
await api(root, { ...input(), versionId: 'old' }, 409);
await api(root, { ...input(), revision: p.revision - 1 }, 409);
await api(root, input(), 401, 'PATCH', false);
assert.deepEqual((await api(root)).project, p);
const first = input();
p = await api(root, first);
await api(root, first, 409);
const saved = structuredClone(current().intervals.at(-1));
assert.deepEqual(
  current().versions.at(-1),
  initialVersion,
  'Computing an interval must not alter data or metadata',
);
assert.equal(saved.mean, 90);
assert.equal(saved.sampleSD, 10);
assert.equal(saved.n, 3);
assert.equal(saved.df, 2);
assert.ok(Math.abs(saved.lower - 65.1586228828) < 1e-6);
assert.ok(Math.abs(saved.upper - 114.8413771172) < 1e-6);
assert.equal(saved.inputDataHash, initialVersion.statistics.inputDataHash);
assert.deepEqual(saved.assumptions, assumptions);
assert.deepEqual(saved.indices, [0, 1, 5]);
assert.equal(saved.versionId, initialVersion.id);
p = await api(root, {
  action: 'experiment.reproducibility',
  revision: p.revision,
  id: experimentId,
  versionId: initialVersion.id,
  metadata: { randomSeed: 'synthetic per-run seeds documented separately' },
  reason: 'Synthetic metadata change to verify interval version tracking.',
});
assert.notEqual(current().versions.at(-1).id, saved.versionId);
assert.deepEqual(
  current().intervals.find((r) => r.id === saved.id),
  saved,
);
await api(root, { ...input(), versionId: initialVersion.id }, 409);
p = await api(root, input());
const renewed = structuredClone(current().intervals.at(-1));
assert.notEqual(renewed.id, saved.id);
assert.notEqual(renewed.versionId, saved.versionId);
assert.equal(renewed.versionId, current().versions.at(-1).id);
assert.equal(renewed.lower, saved.lower);
assert.deepEqual(
  current().intervals.find((r) => r.id === saved.id),
  saved,
);
assert.deepEqual(
  (await api(root)).project.state.experiments.find(
    (e) => e.id === experimentId,
  ),
  current(),
);
const exported = await api(root + '/exports', {}, 201, 'POST');
const bundle = await api(root + '/exports?download=' + exported.id);
const exportedExperiment = bundle.files
  .find((f) => f.name === 'project.json')
  .content.state.experiments.find((e) => e.id === experimentId);
assert.deepEqual(exportedExperiment, current());
for (const record of [saved, renewed]) {
  const version = exportedExperiment.versions.find(
    (v) => v.id === record.versionId,
  );
  assert.equal(version.statistics.inputDataHash, record.inputDataHash);
  assert.deepEqual(
    record.indices.map((i) => version.rows[i].runId),
    record.runIds,
  );
}
const result = {
  requestsPassed: calls,
  projectId,
  experimentId,
  intervalIds: [saved.id, renewed.id],
  exportId: exported.id,
  verifiedAt: new Date().toISOString(),
};
writeFileSync(
  'outputs/v2-validation/experiment-interval-api.json',
  JSON.stringify(result, null, 2) + '\n',
);
console.log(JSON.stringify(result));
