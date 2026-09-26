// Synthetic local fixtures verify human review and provenance guards; no model calls.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  emptyGraph,
  graphExtractionSchema,
  checkedExtraction,
  sha256,
} from '../lib/graph.ts';
const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error('Local only.');
let calls = 0;
async function api(path, body, method = body ? 'POST' : 'GET', status = 200) {
  const response = await fetch(base + path, {
    method,
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
  assert.equal(response.status, status, JSON.stringify(data));
  calls++;
  return data;
}
let project = await api(
  '/api/projects',
  {
    title: `V2 graph review fixture ${Date.now()}`,
    question: 'Synthetic review checks, not an academic result.',
  },
  'POST',
  201,
);
const text = 'Method A uses Dataset X under condition C.';
const form = new FormData();
form.append(
  'file',
  new File([text], 'graph-review-fixture.txt', { type: 'text/plain' }),
);
form.append('revision', String(project.revision));
form.append('blocks', JSON.stringify([{ id: 'b', page: 1, text }]));
project = await api(`/api/projects/${project.id}/documents`, form, 'POST', 201);
const paper = project.state.papers[0];
const { blocks } = await api(`/api/projects/${project.id}/papers/${paper.id}`);
const ref = { blockId: blocks[0].id, quote: text };
const raw = graphExtractionSchema.parse({
  entities: [
    {
      key: 'a',
      name: 'Method A',
      type: 'method',
      domain: 'test',
      definition: 'Synthetic method',
      mentions: [{ ...ref, surface: 'Method A' }],
    },
    {
      key: 'x',
      name: 'Dataset X',
      type: 'data',
      domain: 'test',
      definition: 'Synthetic data',
      mentions: [{ ...ref, surface: 'Dataset X' }],
    },
  ],
  relations: [
    { source: 'a', target: 'x', type: 'uses', condition: 'C', evidence: [ref] },
  ],
});
const graph = {
  ...emptyGraph(),
  ...checkedExtraction(
    raw,
    paper,
    blocks,
    await sha256(JSON.stringify(blocks)),
    'synthetic-run',
  ),
  revision: 1,
};
const relation = graph.relations[0],
  entity = graph.entities[0];
relation.support = 'supported';
const invalidEvidence = {
  ...graph.evidence[0],
  id: randomUUID(),
  parseHash: 'obsolete-parser-fixture',
};
graph.evidence.push(invalidEvidence);
const invalidRelation = {
  ...relation,
  id: randomUUID(),
  evidenceIds: [invalidEvidence.id],
};
graph.relations.push(invalidRelation);
graph.bridges.push({
  id: randomUUID(),
  source: entity.id,
  target: graph.entities[1].id,
  question: 'Fixture only',
  mapping: 'Fixture',
  differences: 'Fixture',
  risks: 'Fixture',
  experiment: 'Fixture',
  evidenceIds: relation.evidenceIds,
  relationIds: [relation.id],
  kind: 'transfer',
  status: 'candidate',
  reason: 'Fixture',
  contextHash: 'fixture',
  runId: 'fixture',
});
const dir = 'outputs/v2-validation';
mkdirSync(dir, { recursive: true });
const q = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const data = JSON.stringify(graph);
const sql = `INSERT INTO graph_revisions (id,project_id,owner,revision,data,hash,action,actor,created_at) VALUES (${q(randomUUID())},${q(project.id)},(SELECT owner FROM projects WHERE id=${q(project.id)}),1,${q(data)},${q(await sha256(data))},'synthetic test seed','local test',${q(new Date().toISOString())});`;
writeFileSync(`${dir}/graph-review-fixture.sql`, sql);
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
    `${dir}/graph-review-fixture.sql`,
    '--json',
  ],
  { stdio: 'pipe', windowsHide: true },
);
const route = `/api/projects/${project.id}/graph`;
let current = (await api(route)).graph;
async function change(action, status = 200) {
  const response = await api(
    route,
    {
      revision: current.revision,
      reason: 'Deterministic local test',
      ...action,
    },
    'PATCH',
    status,
  );
  current = (await api(route)).graph;
  return response;
}
await change(
  { action: 'relation.review', id: invalidRelation.id, status: 'confirmed' },
  400,
);
assert.equal(current.revision, 1);
await change({
  action: 'relation.review',
  id: relation.id,
  status: 'confirmed',
});
assert.equal(
  current.relations.find((r) => r.id === relation.id).status,
  'confirmed',
);
await change({
  action: 'entity.edit',
  id: entity.id,
  name: entity.name,
  aliases: [],
  type: 'concept',
  domain: 'corrected fixture',
  definition: 'Corrected test definition',
});
assert.equal(
  current.relations.find((r) => r.id === relation.id).status,
  'stale',
);
assert.equal(current.bridges[0].status, 'stale');
assert.equal(
  current.evidence.find((e) => e.id === relation.evidenceIds[0]).quote,
  text,
);
await change(
  { action: 'relation.review', id: relation.id, status: 'confirmed' },
  400,
);
await change({
  action: 'relation.correct',
  id: relation.id,
  type: 'compares',
  condition: 'C',
  support: 'supported',
});
await change(
  { action: 'relation.review', id: relation.id, status: 'confirmed' },
  400,
);
await change({
  action: 'relation.correct',
  id: relation.id,
  type: 'uses',
  condition: 'C',
  support: 'supported',
});
await change({
  action: 'relation.review',
  id: relation.id,
  status: 'confirmed',
});
await change({
  action: 'evidence.correct',
  id: relation.evidenceIds[0],
  quote: 'uses Dataset X under condition C.',
});
assert.equal(
  current.relations.find((r) => r.id === relation.id).status,
  'stale',
);
const before = current.revision;
await change(
  {
    action: 'entity.edit',
    id: entity.id,
    name: entity.name,
    aliases: [],
    type: 'invented-type',
  },
  400,
);
assert.equal(current.revision, before);
const report = {
  passedRequests: calls,
  projectId: project.id,
  modelTest: 'not invoked',
  checks: [
    'parse version mismatch',
    'valid evidence confirmation',
    'entity type correction',
    'dependent relation and bridge invalidation',
    'evidence preserved',
    'incompatible comparison blocked',
    'human correction and re-review',
    'quote correction invalidation',
    'invalid type rejected',
  ],
};
writeFileSync(`${dir}/graph-review-api.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
