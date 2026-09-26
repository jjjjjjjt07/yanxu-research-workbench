// Local synthetic project only; excerpts do not call the model.
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
  method = body ? 'POST' : 'GET',
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
const paper = p.state.papers.find(
  (p) => p.filename === 'parse-versions-fixture.txt',
);
const parsing = `${root}/papers/${paper.id}/parsing`;
let s = await api(parsing);
const original = s.blocks[0].text,
  version = s.currentVersionId;
assert.match(original, /Dataset A/);
const savedIds = [];
let answer;
for (let i = 0; i < 11; i++) {
  answer = await api(root + '/ai', {
    task: 'ask',
    mode: 'excerpts',
    paperIds: [paper.id],
    question: `Synthetic persisted question ${Date.now()}-${i}: Dataset A?`,
  });
  assert.ok(answer.savedAnswerId);
  assert.equal(answer.persistenceError, undefined);
  savedIds.push(answer.savedAnswerId);
  assert.equal(answer.sources[0].reference.parseHash, s.hash);
}
assert.deepEqual(
  (await api(root)).project,
  p,
  'History must not mutate project state',
);
let first = await api(root + '/answers');
assert.equal(first.records.length, 10);
assert.ok(first.cursor);
const second = await api(
  root + '/answers?cursor=' + encodeURIComponent(first.cursor),
);
assert.ok(
  [...first.records, ...second.records].some((r) => r.id === savedIds[0]),
);
assert.equal(
  new Set([...first.records, ...second.records].map((r) => r.id)).size,
  first.records.length + second.records.length,
);
const record = first.records.find((r) => r.id === answer.savedAnswerId);
assert.ok(record);
assert.equal(record.status.needsReview, false);
assert.equal(record.model, null);
await api(root + '/answers', undefined, 401, 'GET', false);
await api(
  '/api/projects/00000000-0000-4000-8000-000000000000/answers',
  undefined,
  404,
);
await api(root + '/answers?cursor=' + 'x'.repeat(2001), undefined, 400);
const notePayload = {
  action: 'note.add',
  revision: p.revision,
  paperId: paper.id,
  blockId: s.blocks[0].id,
  text: 'Synthetic historical answer guard.',
  quote: 'Dataset A',
  parseHash: s.hash,
  parseVersionId: s.currentVersionId,
};
await api(root, { ...notePayload, parseHash: '0'.repeat(64) }, 409, 'PATCH');
await api(
  root,
  { ...notePayload, parseVersionId: 'wrong-version' },
  409,
  'PATCH',
);
p = (
  await api(
    parsing,
    {
      action: 'correct',
      blockId: s.blocks[0].id,
      text: original.replace('Dataset A', 'Dataset B'),
      reason: 'Synthetic historical-answer version test.',
      revision: p.revision,
      hash: s.hash,
    },
    200,
    'PATCH',
  )
).project;
first = await api(root + '/answers');
const stale = first.records.find((r) => r.id === record.id);
assert.deepEqual(stale.status.stalePaperIds, [paper.id]);
assert.equal(stale.result.sources[0].quote, original);
assert.deepEqual(
  stale.result,
  record.result,
  'Stored result must be immutable',
);
await api(root, { ...notePayload, revision: p.revision }, 400, 'PATCH');
s = await api(parsing);
p = (
  await api(
    parsing,
    {
      action: 'restore',
      versionId: version,
      reason: 'Restore synthetic original after answer history test.',
      revision: p.revision,
      hash: s.hash,
    },
    200,
    'PATCH',
  )
).project;
s = await api(parsing);
assert.equal(s.blocks[0].text, original);
first = await api(root + '/answers');
assert.equal(
  first.records.find((r) => r.id === record.id).status.needsReview,
  true,
);
await api(root, { ...notePayload, revision: p.revision }, 409, 'PATCH');
const exported = await api(root + '/exports', {}, 201);
const bundle = await api(root + '/exports?download=' + exported.id);
assert.ok(bundle.files.some((f) => f.name === `answers/${record.id}.json`));
assert.deepEqual(
  bundle.files.find((f) => f.name === `answers/${record.id}.json`).content
    .result,
  record.result,
);
const report = {
  requestsPassed: calls,
  projectId,
  answerIds: savedIds,
  exportId: exported.id,
  verifiedAt: new Date().toISOString(),
};
writeFileSync(
  'outputs/v2-validation/answer-history-api.json',
  JSON.stringify(report, null, 2),
);
console.log({
  requestsPassed: calls,
  savedAnswers: savedIds.length,
  exportId: exported.id,
});
