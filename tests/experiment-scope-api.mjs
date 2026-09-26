// Reuses only the named local synthetic project; no model calls.
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
async function api(path, body, status = 200, auth = true) {
  const response = await fetch(base + path, {
    method: body ? 'PATCH' : 'GET',
    headers: {
      ...(auth ? { cookie: '__sites_local_auth=1' } : {}),
      'Content-Type': 'application/json',
      Connection: 'close',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  calls++;
  assert.equal(response.status, status, JSON.stringify(data));
  return data;
}

let { project } = await api(root);
let experiment = project.state.experiments.find(
  (value) => value.name === 'Synthetic observation fixture',
);
assert.ok(experiment && experiment.versions.length < 10);
let version = experiment.versions.at(-1);
const before = structuredClone(project);
const reason = 'Verified structured units and experiment conditions.';
const pairs = [
  ...new Map(
    version.rows.map((row) => [
      JSON.stringify([row.dataset, row.metric]),
      { dataset: row.dataset, metric: row.metric },
    ]),
  ).values(),
];
const values = pairs.map((value) => ({
  ...value,
  unit: 'synthetic percentage points',
  samplingUnit: 'one independent synthetic run',
  conditions: 'synthetic fixed dataset, split and preprocessing only',
}));
const input = (extra = {}) => ({
  action: 'experiment.scope',
  revision: project.revision,
  id: experiment.id,
  versionId: version.id,
  values,
  reason,
  ...extra,
});

await api(root, input({ values: [{ ...values[0], unit: '' }] }), 400);
await api(
  root,
  input({ values: [{ ...values[0], dataset: 'invented-dataset' }] }),
  400,
);
await api(root, input(), 401, false);
assert.deepEqual((await api(root)).project, before);

if (version.scope?.reason !== reason) {
  project = await api(root, input());
  experiment = project.state.experiments.find(
    (value) => value.name === 'Synthetic observation fixture',
  );
  version = experiment.versions.at(-1);
}
assert.equal(version.scope.reason, reason);
assert.deepEqual(version.scope.values, values);
assert.deepEqual(
  version.rows,
  before.state.experiments
    .find((value) => value.id === experiment.id)
    .versions.at(-1).rows,
);

await api(
  root,
  {
    action: 'experiment.interval',
    revision: project.revision,
    id: experiment.id,
    versionId: version.id,
    method: version.rows[0].method,
    dataset: values[0].dataset,
    metric: values[0].metric,
    assumptions: {
      unit: 'changed unit',
      samplingUnit: values[0].samplingUnit,
      conditions: values[0].conditions,
      independent: true,
      independenceBasis: 'synthetic check',
      approximateNormal: true,
      distributionBasis: 'synthetic check',
    },
    reason: 'Must reject a calculation that changes the saved unit.',
  },
  400,
);
await api(root, input({ versionId: version.scope.sourceVersionId }), 409);

const report = {
  projectId,
  experimentId: experiment.id,
  versionId: version.id,
  scopes: version.scope.values.length,
  calls,
  verifiedAt: new Date().toISOString(),
};
writeFileSync(
  'outputs/v2-validation/experiment-scope-api.json',
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
