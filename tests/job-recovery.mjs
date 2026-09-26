// Local fault fixtures exercise the real executor without any model request.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { researchContext } from '../lib/research-context.ts';
const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error('Local test server required.');
const directory = 'outputs/v2-validation';
mkdirSync(directory, { recursive: true });
async function api(path, body) {
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      cookie: '__sites_local_auth=1',
      ...(body instanceof FormData
        ? {}
        : { 'Content-Type': 'application/json' }),
    },
    ...(body
      ? { body: body instanceof FormData ? body : JSON.stringify(body) }
      : {}),
  });
  const data = await response.json();
  assert.ok(response.ok, JSON.stringify(data));
  return data;
}
let project = await api('/api/projects', {
  title: `V2 recovery fixture ${Date.now()}`,
  question: 'Synthetic executor recovery test; no academic claim.',
});
const text = 'The independent test set contains 1200 images.';
const form = new FormData();
form.append(
  'file',
  new File([text], 'recovery-fixture.txt', { type: 'text/plain' }),
);
form.append('revision', String(project.revision));
form.append(
  'blocks',
  JSON.stringify([{ id: 'recovery-block', page: 1, text }]),
);
project = await api(`/api/projects/${project.id}/documents`, form);
const paper = project.state.papers[0],
  field = project.state.fields[0];
const { blocks } = await api(`/api/projects/${project.id}/papers/${paper.id}`);
const snapshot = {
  paperHash: paper.hash,
  fields: [field],
  rules: [],
  context: JSON.stringify(researchContext(project)),
  contextVersion: project.state.contextVersion ?? 0,
};
const result = {
  cells: [
    {
      fieldId: field.id,
      value: '1200',
      blockId: blocks[0].id,
      quote: text,
      note: 'Cached synthetic recovery fixture',
    },
  ],
};
const ids = Object.fromEntries(
  [
    'recovered',
    'exhausted',
    'stale',
    'graphExhausted',
    'graphStale',
    'cancelled',
  ].map((k) => [k, randomUUID()]),
);
const q = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const old = '2020-01-01T00:00:00.000Z';
// Obtain owner from the newly created project. No credential or existing project is copied.
const owner = `(SELECT owner FROM projects WHERE id=${q(project.id)})`;
function matrix(id, attempts, snap, cached) {
  return `INSERT INTO jobs (id,owner,project_id,paper_id,field_ids,status,snapshot,result,attempts,created_at,updated_at) VALUES (${q(id)},${owner},${q(project.id)},${q(paper.id)},${q(JSON.stringify([field.id]))},'running',${q(JSON.stringify(snap))},${cached ? q(JSON.stringify(cached)) : 'NULL'},${attempts},${q(old)},${q(old)});`;
}
function graph(id, paperId, status, attempts) {
  return `INSERT INTO graph_jobs (id,batch_id,owner,project_id,paper_id,task,status,stage,snapshot,attempts,lease,lease_until,next_at,created_at,updated_at) VALUES (${q(id)},${q(id)},${owner},${q(project.id)},${q(paperId)},'extract',${q(status)},'retrieving',${q(JSON.stringify({ contextHash: 'obsolete-context' }))},${attempts},'expired-fixture',${q(old)},${q(old)},${q(old)},${q(old)});`;
}
const statements = [
  matrix(ids.recovered, 1, snapshot, result),
  matrix(ids.exhausted, 3, snapshot, null),
  matrix(
    ids.stale,
    2,
    { ...snapshot, context: 'old-context', contextVersion: 0 },
    result,
  ),
  graph(ids.graphExhausted, 'exhausted-fixture', 'running', 3),
  graph(ids.graphStale, paper.id, 'running', 1),
  graph(ids.cancelled, 'cancelled-fixture', 'cancelled', 0),
];
const sqlPath = `${directory}/job-recovery-fixture.sql`;
writeFileSync(sqlPath, statements.join('\n'));
execFileSync(
  process.execPath,
  [
    'node_modules/wrangler/bin/wrangler.js',
    'd1',
    'execute',
    'DB',
    '--local',
    '--config',
    'wrangler.local.json',
    '--file',
    sqlPath,
    '--json',
  ],
  { stdio: 'pipe', windowsHide: true },
);
let state, graphState;
for (let i = 0; i < 20; i++) {
  await delay(1000);
  state = await api(`/api/projects/${project.id}`);
  graphState = await api(`/api/projects/${project.id}/graph`);
  if (
    state.jobs.length === 3 &&
    state.jobs.every((j) => ['succeeded', 'failed'].includes(j.status)) &&
    graphState.jobs.every((j) => ['failed', 'cancelled'].includes(j.status))
  )
    break;
}
assert.equal(
  state.jobs.find((j) => j.id === ids.recovered)?.status,
  'succeeded',
);
assert.match(state.jobs.find((j) => j.id === ids.exhausted)?.error, /重试上限/);
assert.match(state.jobs.find((j) => j.id === ids.stale)?.error, /旧结果已隔离/);
assert.equal(
  state.project.revision,
  project.revision + 1,
  'Only the cached valid result should commit.',
);
assert.equal(
  state.project.state.cells.find(
    (c) => c.paperId === paper.id && c.fieldId === field.id,
  ).value,
  '1200',
);
assert.equal(
  graphState.jobs.find((j) => j.id === ids.graphExhausted)?.errorKind,
  'lease_expired',
);
assert.equal(
  graphState.jobs.find((j) => j.id === ids.graphStale)?.errorKind,
  'stale_input',
);
assert.equal(
  graphState.jobs.find((j) => j.id === ids.cancelled)?.status,
  'cancelled',
);
assert.equal(
  graphState.graph.revision,
  0,
  'Invalid graph attempts must never publish a revision.',
);
await delay(3500);
assert.equal(
  (await api(`/api/projects/${project.id}`)).project.revision,
  state.project.revision,
  'Repeated executor ticks must not republish.',
);
const report = {
  passed: 10,
  projectId: project.id,
  modelTest: 'not invoked',
  scope:
    'Stored crash/lease/context/cancel fixtures; not process-kill or network fault injection',
};
writeFileSync(
  `${directory}/job-recovery.json`,
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
