// Local synthetic provenance regression; one isolated project, no model calls.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { emptyGraph, sha256 } from '../lib/graph.ts';
const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error('Local only');
let calls = 0;
async function api(
  path,
  body,
  status = 200,
  method = body ? 'POST' : 'GET',
  auth = true,
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      ...(auth ? { cookie: '__sites_local_auth=1' } : {}),
      Connection: 'close',
      ...(body instanceof FormData
        ? {}
        : { 'Content-Type': 'application/json' }),
    },
    ...(body
      ? { body: body instanceof FormData ? body : JSON.stringify(body) }
      : {}),
  });
  const data = await r.json();
  calls++;
  assert.equal(r.status, status, JSON.stringify(data));
  return data;
}
let p = await api(
  '/api/projects',
  {
    title: `V2 parse versions fixture ${Date.now()}`,
    question: 'Synthetic parse version verification.',
  },
  201,
);
const path = `/api/projects/${p.id}`;
writeFileSync(
  'outputs/v2-validation/parse-versions-fixture-id.json',
  JSON.stringify({ projectId: p.id }),
);
const original =
  'Synthetic method uses Dataset A. This is a parsing fixture, not research data.';
const form = new FormData();
form.set('file', new File([original], 'parse-versions-fixture.txt'));
form.set('revision', String(p.revision));
form.set('blocks', JSON.stringify([{ id: 'b', page: 1, text: original }]));
p = await api(path + '/documents', form, 201);
const paper = p.state.papers[0],
  route = path + '/papers/' + paper.id + '/parsing';
let s = await api(route);
assert.equal(s.versions.length, 1);
assert.equal(s.versions[0].at, null);
const block = s.blocks[0];
const db = new DatabaseSync(
  '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite',
);
const row = db.prepare('SELECT * FROM projects WHERE id=?').get(p.id);
assert.equal(row.question, 'Synthetic parse version verification.');
const eid = randomUUID(),
  source = randomUUID(),
  target = randomUUID(),
  rid = randomUUID();
const graph = {
  ...emptyGraph(),
  revision: 1,
  entities: [source, target].map((id, i) => ({
    id,
    name: i ? 'Dataset A' : 'Synthetic method',
    type: i ? 'data' : 'method',
    aliases: [],
    domain: 'fixture',
    definition: 'synthetic',
    paperIds: [paper.id],
  })),
  evidence: [
    {
      id: eid,
      paperId: paper.id,
      documentHash: paper.hash,
      parseHash: s.hash,
      blockId: block.id,
      page: 1,
      quote: original,
      runId: 'synthetic',
    },
  ],
  relations: [
    {
      id: rid,
      source,
      target,
      type: 'uses',
      condition: 'synthetic',
      evidenceIds: [eid],
      status: 'confirmed',
      support: 'supported',
      reason: 'synthetic',
      runId: 'synthetic',
    },
  ],
  bridges: [
    {
      id: randomUUID(),
      source,
      target,
      evidenceIds: [eid],
      relationIds: [rid],
      status: 'tried',
      kind: 'transfer',
      reason: 'fixture',
      question: 'fixture',
      mapping: 'fixture',
      differences: 'fixture',
      risks: 'fixture',
      experiment: 'fixture',
      contextHash: 'fixture',
      runId: 'fixture',
    },
  ],
};
Object.assign(p.state.cells[0], {
  value: 'Manual value retained',
  blockId: block.id,
  quote: original,
  page: 1,
  sourceValid: true,
  status: 'confirmed',
  origin: 'manual',
  evidenceRef: {
    id: eid,
    graphRevision: 1,
    documentHash: paper.hash,
    parseHash: s.hash,
  },
});
p.state.cells[0].candidate = {
  ...p.state.cells[0],
  value: 'Candidate retained',
};
delete p.state.cells[0].candidate.candidate;
delete p.state.cells[0].candidate.history;
p.state.notes.push({
  id: randomUUID(),
  paperId: paper.id,
  blockId: block.id,
  text: 'Original note retained',
  at: new Date().toISOString(),
});
db.prepare(
  'UPDATE projects SET state=?,revision=revision+1 WHERE id=? AND revision=?',
).run(JSON.stringify(p.state), p.id, p.revision);
db.prepare(
  'INSERT INTO graph_revisions (id,project_id,owner,revision,data,hash,action,actor,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
).run(
  randomUUID(),
  p.id,
  row.owner,
  1,
  JSON.stringify(graph),
  await sha256(JSON.stringify(graph)),
  'synthetic seed',
  'local test',
  new Date().toISOString(),
);
db.close();
p = (await api(path)).project;
s = await api(route);
const payload = (text, extra = {}) => ({
  action: 'correct',
  revision: p.revision,
  hash: s.hash,
  blockId: block.id,
  text,
  reason: 'Synthetic correction validation',
  ...extra,
});
await api(route, payload('changed', { reason: '' }), 400, 'PATCH');
await api(route, payload('changed', { hash: '0'.repeat(64) }), 409, 'PATCH');
await api(
  route,
  payload('changed', { revision: p.revision - 1 }),
  409,
  'PATCH',
);
await api(route, payload('changed', { blockId: 'missing' }), 400, 'PATCH');
await api(route, payload('changed'), 401, 'PATCH', false);
assert.equal(
  (await api(route, payload(original), 200, 'PATCH')).unchanged,
  true,
);
const beforeRevision = p.revision;
const edited = await api(
  route,
  payload(original.replace('Dataset A', 'Dataset B')),
  200,
  'PATCH',
);
p = edited.project;
assert.equal(p.revision, beforeRevision + 1);
const cell = p.state.cells[0];
assert.equal(cell.value, 'Manual value retained');
assert.equal(cell.status, 'stale');
assert.equal(cell.sourceValid, false);
assert.equal(cell.candidate.sourceValid, false);
assert.equal(p.state.notes[0].sourceNeedsReview, true);
const g = (await api(path + '/graph')).graph;
assert.equal(g.relations[0].status, 'stale');
assert.equal(g.bridges[0].status, 'stale');
assert.equal(g.evidence[0].parseHash, s.hash);
const current = await api(path + '/papers/' + paper.id);
assert.match(current.blocks[0].text, /Dataset B/);
assert.equal(current.blocks[0].id, block.id);
const baseline = await api(route + '?version=original');
assert.equal(baseline.blocks[0].text, original);
await api(route + '?version=unknown', undefined, 404);
const raw = await fetch(base + path + '/papers/' + paper.id + '?raw=1', {
  headers: { cookie: '__sites_local_auth=1' },
});
calls++;
assert.equal(await raw.text(), original);
await api(
  path + '/graph',
  {
    action: 'evidence.toCell',
    id: eid,
    fieldId: p.state.fields[0].id,
    value: 'old value',
    reason: 'should reject old parse',
    projectRevision: p.revision,
    revision: g.revision,
  },
  400,
  'PATCH',
);
s = await api(route);
const restored = await api(
  route,
  {
    action: 'restore',
    versionId: 'original',
    reason: 'Synthetic restore validation',
    revision: p.revision,
    hash: s.hash,
  },
  200,
  'PATCH',
);
p = restored.project;
assert.equal(p.state.papers[0].parseVersions.length, 3);
assert.equal(p.state.papers[0].parseVersions[2].restoredFrom, 'original');
assert.equal(p.state.cells[0].status, 'stale');
assert.equal(
  (await api(path + '/papers/' + paper.id)).blocks[0].text,
  original,
);
s = await api(route);
const race = payload('race one');
const responses = await Promise.all([
  fetch(base + route, {
    method: 'PATCH',
    headers: {
      cookie: '__sites_local_auth=1',
      'Content-Type': 'application/json',
      Connection: 'close',
    },
    body: JSON.stringify(race),
  }),
  fetch(base + route, {
    method: 'PATCH',
    headers: {
      cookie: '__sites_local_auth=1',
      'Content-Type': 'application/json',
      Connection: 'close',
    },
    body: JSON.stringify({ ...race, text: 'race two' }),
  }),
]);
calls += 2;
assert.deepEqual(responses.map((r) => r.status).sort((a, b) => a - b), [200, 409]);
p = (await api(path)).project;
assert.equal(p.state.papers[0].parseVersions.length, 4);
const report = {
  requestsPassed: calls,
  projectId: p.id,
  paperId: paper.id,
  verifiedAt: new Date().toISOString(),
};
writeFileSync(
  'outputs/v2-validation/parse-versions-api.json',
  JSON.stringify(report, null, 2),
);
console.log(report);
