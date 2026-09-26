// Local synthetic fixtures; never requests model calls or edits existing projects.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cellSnapshot } from '../lib/domain.ts';
const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error('Local only');
let calls = 0;
async function api(path, body, expected = 200, method = body ? 'POST' : 'GET') {
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
  assert.equal(response.status, expected, JSON.stringify(data));
  calls++;
  return data;
}
let project = await api(
  '/api/projects',
  {
    title: `V2 candidate review fixture ${Date.now()}`,
    question: 'Synthetic candidate review tests, not academic results.',
  },
  201,
);
const text =
  'Method A uses Dataset X. Latency is 1000 ms. The test set has 1200 images.';
const form = new FormData();
form.append(
  'file',
  new File([text], 'candidate-fixture.txt', { type: 'text/plain' }),
);
form.append('revision', String(project.revision));
form.append('blocks', JSON.stringify([{ id: 'b', page: 1, text }]));
project = await api(`/api/projects/${project.id}/documents`, form, 201);
const paper = project.state.papers[0];
const { blocks } = await api(`/api/projects/${project.id}/papers/${paper.id}`);
const values = [
  ['Method A', 'Method  A'],
  ['1000 ms', '1 s'],
  ['1200', '1300'],
  ['Dataset X', 'Dataset X'],
  ['Method A', 'Method A'],
];
for (const [index, cell] of project.state.cells.entries()) {
  Object.assign(cell, {
    value: values[index][0],
    blockId: blocks[0].id,
    quote: text,
    page: 1,
    sourceValid: true,
    note: '',
    status: 'confirmed',
    origin: 'manual',
  });
  cell.candidate = {
    ...cellSnapshot(cell),
    origin: 'ai',
    value: values[index][1],
  };
  if (index === 3) {
    cell.quote = 'This text does not exist in the paper.';
    cell.candidate.quote = cell.quote;
  }
  if (index === 4) cell.candidate.note = 'Only under condition Z.';
}
const dir = 'outputs/v2-validation';
mkdirSync(dir, { recursive: true });
const q = (value) => "'" + String(value).replaceAll("'", "''") + "'";
writeFileSync(
  `${dir}/candidate-fixture.sql`,
  `UPDATE projects SET state=${q(JSON.stringify(project.state))} WHERE id=${q(project.id)} AND revision=${project.revision};`,
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
    `${dir}/candidate-fixture.sql`,
    '--json',
  ],
  { stdio: 'pipe', windowsHide: true },
);
const route = `/api/projects/${project.id}`;
const cellIds = project.state.cells.map((c) => c.id);
const originalRevision = project.revision;
async function batch(
  ids,
  decision = 'accept',
  expected = 200,
  reviewRevision = project.revision,
) {
  const result = await api(
    route,
    {
      revision: project.revision,
      reviewRevision,
      action: 'candidate.batch',
      ids,
      decision,
      reason: 'Deterministic candidate review test',
    },
    expected,
    'PATCH',
  );
  if (expected === 200) project = result;
  return result;
}
await batch([cellIds[0], cellIds[1]], 'accept', 400);
await batch([cellIds[0], cellIds[3]], 'accept', 400);
await batch([cellIds[0], cellIds[0]], 'accept', 400);
await batch(['not-in-project'], 'accept', 409);
await batch([cellIds[0]], 'accept', 409, originalRevision - 1);
const unchanged = (await api(route)).project;
assert.equal(unchanged.revision, originalRevision);
assert.deepEqual(unchanged.state, project.state);
await batch([cellIds[0]]);
assert.equal(project.revision, originalRevision + 1);
assert.equal(project.state.cells[0].value, 'Method  A');
assert.equal(project.state.candidateReviews.length, 1);
assert.ok(project.state.candidateReviews[0].actor);
assert.equal(project.state.candidateReviews[0].before.value, 'Method A');
assert.equal(project.state.candidateReviews[0].after.value, 'Method  A');
await batch([cellIds[1], cellIds[2]], 'retain');
assert.equal(project.state.cells[1].value, '1000 ms');
assert.equal(project.state.cells[2].value, '1200');
assert.equal(project.state.candidateReviews.length, 3);
assert.equal(
  project.state.candidateReviews[1].batchId,
  project.state.candidateReviews[2].batchId,
);
assert.equal(project.state.cells[1].candidate, undefined);
await api(
  route,
  { revision: project.revision, action: 'cell.accept', id: cellIds[3] },
  400,
  'PATCH',
);
assert.equal((await api(route)).project.revision, project.revision);
const report = {
  passedRequests: calls,
  projectId: project.id,
  checks: [
    'whole batch rollback',
    'stale preview rejected',
    'scope and duplicate protection',
    'actual quote revalidation',
    'accept audit',
    'retain original values',
    'shared batch record',
    'single accept source guard',
  ],
  modelTest: 'not invoked',
};
writeFileSync(`${dir}/candidate-api.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
