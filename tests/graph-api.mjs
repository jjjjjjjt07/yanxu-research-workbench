import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error('Local test server required.');
let count = 0;
async function api(path, body, expected = 200, method = body ? 'POST' : 'GET') {
  const r = await fetch(base + path, {
    method,
    headers: {
      cookie: '__sites_local_auth=1',
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  assert.equal(r.status, expected, JSON.stringify(data));
  count++;
  return data;
}
const p = await api(
  '/api/projects',
  {
    title: `V2 integration ${Date.now()}`,
    question: 'Mechanism tests, no scholarly quality claim.',
  },
  201,
);
const route = `/api/projects/${p.id}/graph`;
assert.equal((await fetch(base + route)).status, 401);
count++;
assert.equal((await api(route)).graph.revision, 0);
await api('/api/internal/graph-runner', {}, 401);
await api(
  route,
  {
    action: 'entity.edit',
    id: 'not-in-project',
    name: 'X',
    aliases: [],
    reason: 'test',
    revision: 0,
  },
  404,
  'PATCH',
);
const view = {
  action: 'view.save',
  name: 'Test view',
  focus: '',
  query: '',
  type: 'all',
  review: 'all',
  network: 'concept',
  depth: 1,
  positions: {},
  revision: 0,
};
await api(route, view, 200, 'PATCH');
await api(route, view, 409, 'PATCH');
const attempts = await Promise.all(
  [1, 2].map((n) =>
    fetch(base + route, {
      method: 'PATCH',
      headers: {
        cookie: '__sites_local_auth=1',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...view, revision: 1, name: `Concurrent ${n}` }),
    }),
  ),
);
assert.deepEqual(
  attempts.map((r) => r.status).sort((a, b) => a - b),
  [200, 409],
);
count++;
await api(
  route,
  { action: 'graph.restore', targetRevision: 1, revision: 2 },
  200,
  'PATCH',
);
const loaded = await api(route);
assert.equal(loaded.graph.revision, 3);
assert.equal(loaded.history.length, 3);
const bundle = await api(`/api/projects/${p.id}/exports`, {}, 201);
const response = await fetch(
  `${base}/api/projects/${p.id}/exports?download=${bundle.id}`,
  { headers: { cookie: '__sites_local_auth=1' } },
);
assert.equal(response.status, 200);
const bytes = await response.text();
assert.equal(createHash('sha256').update(bytes).digest('hex'), bundle.hash);
const contents = JSON.parse(bytes);
for (const file of contents.files)
  assert.equal(
    createHash('sha256').update(JSON.stringify(file.content)).digest('hex'),
    file.sha256,
  );
count++;
assert.equal(/AI_API_KEY|JOB_RUNNER_SECRET/.test(bytes), false);
count++;
const other = await api(
  '/api/projects',
  { title: 'Other graph scope ' + Date.now() },
  201,
);
await api(
  `/api/projects/${other.id}/exports?download=${bundle.id}`,
  undefined,
  404,
);
await api(
  `/api/projects/${other.id}/graph`,
  { action: 'graph.restore', targetRevision: 1, revision: 0 },
  404,
  'PATCH',
);
const report = {
  passed: count,
  projectId: p.id,
  modelTest: 'not invoked',
  checked: [
    'authentication',
    'project scoping',
    'concurrent revisions',
    'append-only restore',
    'download',
    'SHA-256 manifest',
    'secret exclusion',
  ],
};
mkdirSync('outputs/v2-validation', { recursive: true });
writeFileSync(
  'outputs/v2-validation/graph-api.json',
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
