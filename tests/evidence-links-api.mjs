// Local synthetic graph/table provenance checks. No model calls or edits to existing projects.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { emptyGraph, sha256 } from '../lib/graph.ts';
const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error('Local only');
let calls = 0;
async function api(path, body, expected = 200, method = body ? 'POST' : 'GET') {
  const response = await fetch(base + path, {
    method,
    headers: {
      cookie: '__sites_local_auth=1',
      Connection: 'close',
      ...(body instanceof FormData
        ? {}
        : { 'Content-Type': 'application/json' }),
    },
    ...(body
      ? { body: body instanceof FormData ? body : JSON.stringify(body) }
      : {}),
  });
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data));
  calls++;
  return data;
}
let project = await api(
  '/api/projects',
  {
    title: `V2 evidence link fixture ${Date.now()}`,
    question: 'Synthetic source link verification.',
  },
  201,
);
const text = 'Method A uses Dataset X under condition C.';
const form = new FormData();
form.append(
  'file',
  new File([text], 'evidence-link-fixture.txt', { type: 'text/plain' }),
);
form.append('revision', String(project.revision));
form.append('blocks', JSON.stringify([{ id: 'b', page: 1, text }]));
project = await api(`/api/projects/${project.id}/documents`, form, 201);
const paper = project.state.papers[0];
const { blocks } = await api(`/api/projects/${project.id}/papers/${paper.id}`);
const evidence = {
  id: randomUUID(),
  paperId: paper.id,
  documentHash: paper.hash,
  parseHash: await sha256(JSON.stringify(blocks)),
  blockId: blocks[0].id,
  page: 1,
  quote: text,
  runId: 'synthetic',
};
let graph = {
  ...emptyGraph(),
  revision: 1,
  evidence: [evidence],
  entities: [
    {
      id: randomUUID(),
      name: 'Method A',
      type: 'method',
      aliases: [],
      domain: 'test',
      definition: 'Synthetic',
      paperIds: [paper.id],
    },
  ],
};
graph.mentions.push({
  id: randomUUID(),
  entityId: graph.entities[0].id,
  evidenceId: evidence.id,
  surface: 'Method A',
});
const obsoleteId = randomUUID();
graph.evidence.push({ ...evidence, id: obsoleteId, parseHash: 'obsolete' });
const dir = 'outputs/v2-validation';
mkdirSync(dir, { recursive: true });
const q = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const data = JSON.stringify(graph);
writeFileSync(
  `${dir}/evidence-link-fixture.sql`,
  `INSERT INTO graph_revisions (id,project_id,owner,revision,data,hash,action,actor,created_at) VALUES (${q(randomUUID())},${q(project.id)},(SELECT owner FROM projects WHERE id=${q(project.id)}),1,${q(data)},${q(await sha256(data))},'synthetic seed','local test',${q(new Date().toISOString())});`,
);
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
    `${dir}/evidence-link-fixture.sql`,
    '--json',
  ],
  { stdio: 'pipe', windowsHide: true },
);
const route = `/api/projects/${project.id}`;
const first = project.state.cells[0].id;
async function refresh() {
  project = (await api(route)).project;
  graph = (await api(route + '/graph')).graph;
}
async function link(fieldId, extra = {}, expected = 200) {
  return api(
    route + '/graph',
    {
      action: 'evidence.toCell',
      revision: graph.revision,
      projectRevision: project.revision,
      id: evidence.id,
      fieldId,
      value: 'Method A',
      reason: 'Synthetic explicit citation',
      ...extra,
    },
    expected,
    'PATCH',
  );
}
await link(project.state.fields[0].id, { id: obsoleteId }, 400);
await link('missing', {}, 404);
await link(project.state.fields[0].id, { projectRevision: 1 }, 409);
await refresh();
assert.equal(graph.revision, 1);
assert.equal(project.revision, 2);
await link(project.state.fields[0].id);
await refresh();
let cell = project.state.cells.find((c) => c.id === first);
assert.equal(cell.value, '');
assert.equal(cell.candidate.evidenceRef.id, evidence.id);
assert.equal(cell.status, 'pending');
const before = JSON.stringify(project);
await link(project.state.fields[0].id, {}, 409);
await refresh();
assert.equal(JSON.stringify(project), before);
project = await api(
  route,
  {
    action: 'cell.accept',
    id: first,
    revision: project.revision,
    reason: 'Explicit human review',
  },
  200,
  'PATCH',
);
cell = project.state.cells.find((c) => c.id === first);
assert.equal(cell.status, 'confirmed');
assert.equal(cell.evidenceRef.id, evidence.id);
await link(project.state.fields[1].id);
await refresh();
const savedRevision = project.revision;
await api(
  route + '/graph',
  {
    action: 'evidence.correct',
    id: evidence.id,
    revision: graph.revision,
    quote: 'Method A uses Dataset X',
    reason: 'Synthetic narrower source',
  },
  200,
  'PATCH',
);
await refresh();
cell = project.state.cells.find((c) => c.id === first);
assert.equal(project.revision, savedRevision + 1);
assert.equal(cell.status, 'stale');
assert.equal(cell.sourceValid, false);
assert.equal(cell.value, 'Method A');
assert.equal(cell.history.at(-1).value.sourceValid, true);
assert.equal(project.state.cells[1].candidate.sourceValid, false);
await api(
  route,
  {
    action: 'cell.accept',
    id: project.state.cells[1].id,
    revision: project.revision,
  },
  400,
  'PATCH',
);
await api(
  route + '/graph',
  { action: 'graph.restore', revision: graph.revision, targetRevision: 2 },
  200,
  'PATCH',
);
await refresh();
assert.equal(project.state.cells[0].status, 'stale');
assert.equal(project.state.cells[1].candidate.sourceValid, false);
// A concurrent user edit cannot be silently lost by source invalidation.
project = await api(
  route,
  {
    action: 'cell.reject',
    id: project.state.cells[1].id,
    revision: project.revision,
  },
  200,
  'PATCH',
);
await link(project.state.fields[1].id);
await refresh();
const responses = await Promise.all([
  fetch(base + route + '/graph', {
    method: 'PATCH',
    headers: {
      cookie: '__sites_local_auth=1',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'evidence.correct',
      id: evidence.id,
      revision: graph.revision,
      quote: 'Method A',
      reason: 'Concurrent source edit',
    }),
  }),
  fetch(base + route, {
    method: 'PATCH',
    headers: {
      cookie: '__sites_local_auth=1',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action: 'cell.accept',
      id: project.state.cells[1].id,
      revision: project.revision,
    }),
  }),
]);
for (const response of responses) {
  assert.ok([200, 409].includes(response.status), await response.text());
  calls++;
}
await refresh();
if (graph.evidence.find((e) => e.id === evidence.id).quote === 'Method A') {
  const linked = project.state.cells[1];
  assert.ok(
    linked.candidate
      ? !linked.candidate.sourceValid
      : linked.status === 'stale',
  );
}
writeFileSync(
  `${dir}/evidence-links-api.json`,
  JSON.stringify(
    {
      projectId: project.id,
      calls,
      graphRevision: graph.revision,
      projectRevision: project.revision,
      checks:
        'link validation, preserve current, duplicate guard, confirmation, atomic invalidation, restore, concurrency',
      at: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ passed: calls, projectId: project.id }));
