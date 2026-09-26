// Reuses only the named local synthetic project; no model calls.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error('Local only');
const { projectId } = JSON.parse(
  readFileSync('outputs/v2-validation/parse-versions-fixture-id.json', 'utf8'),
);
const root = `/api/projects/${projectId}`;
const endpoint = `${root}/experiments/artifacts`;
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
  const data = await response.json();
  calls++;
  assert.equal(response.status, status, JSON.stringify(data));
  return data;
}

let { project } = await api(root);
let experiment = project.state.experiments.find(
  (value) => value.name === 'Synthetic observation fixture',
);
assert.ok(experiment);
const versionId = experiment.versions.at(-1).id;
const marker = 'Synthetic independent reproduction API evidence';
const evidence = {
  code: 'synthetic-code-snapshot',
  environment: 'synthetic-environment-lock',
  result: 'synthetic-independent-result',
};
const upload = (kind, extra = {}) => ({
  revision: project.revision,
  experimentId: experiment.id,
  versionId,
  kind,
  filename: `${kind}-fixture.txt`,
  note: `${marker}: ${kind}`,
  base64: Buffer.from(evidence[kind]).toString('base64'),
  ...extra,
});

await api(endpoint, upload('code', { base64: '' }), 400, 'POST');
await api(endpoint, upload('code'), 401, 'POST', false);

for (const kind of Object.keys(evidence)) {
  experiment = project.state.experiments.find(
    (value) => value.name === 'Synthetic observation fixture',
  );
  if (
    !experiment.artifacts?.some(
      (artifact) => artifact.note === `${marker}: ${kind}`,
    )
  )
    project = await api(endpoint, upload(kind), 201, 'POST');
}
experiment = project.state.experiments.find(
  (value) => value.name === 'Synthetic observation fixture',
);
const artifacts = Object.keys(evidence).map((kind) =>
  experiment.artifacts.find(
    (artifact) => artifact.note === `${marker}: ${kind}`,
  ),
);
assert.ok(artifacts.every(Boolean));

for (const artifact of artifacts) {
  const response = await fetch(
    `${base}${endpoint}?artifactId=${encodeURIComponent(artifact.id)}`,
    { headers: { cookie: '__sites_local_auth=1', Connection: 'close' } },
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  calls++;
  assert.equal(response.status, 200);
  assert.equal(bytes.toString(), evidence[artifact.kind]);
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    artifact.sha256,
  );
  assert.equal(response.headers.get('x-content-sha256'), artifact.sha256);
}

const reason =
  'Verified independent reproduction record through the local API.';
const verify = (extra = {}) => ({
  revision: project.revision,
  experimentId: experiment.id,
  versionId,
  artifactIds: artifacts.map((artifact) => artifact.id),
  executor: 'Separate synthetic verification operator',
  independenceBasis:
    'Separate synthetic workspace and operator; no real research claim.',
  result: 'reproduced',
  findings: 'The synthetic output matched the expected fixture bytes.',
  confirmed: true,
  reason,
  ...extra,
});
await api(endpoint, verify({ confirmed: false }), 400);
await api(
  endpoint,
  verify({ artifactIds: [artifacts[0].id, artifacts[1].id, 'missing'] }),
  400,
);
let record = experiment.reproductions?.find((value) => value.reason === reason);
if (!record) {
  project = await api(endpoint, verify());
  experiment = project.state.experiments.find(
    (value) => value.name === 'Synthetic observation fixture',
  );
  record = experiment.reproductions.find((value) => value.reason === reason);
}
assert.equal(record.verification, 'user_attested_hash_checked_attachments');
assert.equal(record.versionId, versionId);
assert.deepEqual(
  record.artifactIds,
  artifacts.map((artifact) => artifact.id),
);

const report = {
  projectId,
  experimentId: experiment.id,
  versionId,
  artifactIds: artifacts.map((artifact) => artifact.id),
  reproductionId: record.id,
  calls,
  verifiedAt: new Date().toISOString(),
};
writeFileSync(
  'outputs/v2-validation/experiment-artifacts-api.json',
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
