// Reuses an explicitly synthetic local fixture; no model calls.
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
  const r = await fetch(base + path, {
    method: body ? 'PATCH' : 'GET',
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
assert.match(s.blocks[0].text, /Dataset A/);
const original = s.blocks[0].text,
  startVersion = s.currentVersionId;
const add = {
  action: 'note.add',
  paperId: paper.id,
  blockId: s.blocks[0].id,
  text: 'Synthetic source review note: verify dataset against original.',
};
await api(root, { ...add, blockId: 'missing', revision: p.revision }, 400);
p = await api(root, { ...add, revision: p.revision });
const noteId = p.state.notes.at(-1).id;
let n = p.state.notes.find((n) => n.id === noteId);
assert.equal(n.source.quote, original);
assert.equal(n.source.parseHash, s.hash);
assert.equal(n.source.review, undefined);
const payload = {
  action: 'note.source',
  id: noteId,
  blockId: s.blocks[0].id,
  quote: 'Dataset A',
  parseHash: s.hash,
  reason: 'Synthetic test: compared source.',
};
await api(root, { ...payload, reason: '', revision: p.revision }, 400);
await api(
  root,
  { ...payload, quote: 'Invented data', revision: p.revision },
  400,
);
await api(
  root,
  { ...payload, parseHash: '0'.repeat(64), revision: p.revision },
  409,
);
await api(root, { ...payload, revision: p.revision - 1 }, 409);
await api(root, { ...payload, revision: p.revision }, 401, false);
assert.deepEqual((await api(root)).project, p);
p = await api(root, { ...payload, revision: p.revision });
n = p.state.notes.find((n) => n.id === noteId);
assert.equal(n.sourceHistory.length, 1);
assert.equal(n.sourceHistory[0].source.quote, original);
assert.equal(n.source.quote, 'Dataset A');
assert.equal(n.sourceNeedsReview, false);
const reviewed = structuredClone(n.source);
s = await api(parsing);
p = (
  await api(parsing, {
    action: 'correct',
    blockId: s.blocks[0].id,
    text: original.replace('Dataset A', 'Dataset B'),
    reason: 'Synthetic source invalidation test.',
    revision: p.revision,
    hash: s.hash,
  })
).project;
n = p.state.notes.find((n) => n.id === noteId);
assert.equal(n.sourceNeedsReview, true);
assert.deepEqual(n.source, reviewed);
assert.equal(n.text, add.text);
s = await api(parsing);
await api(root, { ...payload, parseHash: s.hash, revision: p.revision }, 400);
p = await api(root, {
  ...payload,
  quote: 'Dataset B',
  parseHash: s.hash,
  revision: p.revision,
});
n = p.state.notes.find((n) => n.id === noteId);
assert.equal(n.sourceHistory[1].sourceNeedsReview, true);
assert.deepEqual(n.sourceHistory[1].source, reviewed);
s = await api(parsing);
p = (
  await api(parsing, {
    action: 'restore',
    versionId: startVersion,
    reason: 'Restore synthetic text after note test.',
    revision: p.revision,
    hash: s.hash,
  })
).project;
assert.equal(
  p.state.notes.find((n) => n.id === noteId).sourceNeedsReview,
  true,
);
s = await api(parsing);
assert.equal(s.blocks[0].text, original);
p = await api(root, { ...payload, parseHash: s.hash, revision: p.revision });
n = p.state.notes.find((n) => n.id === noteId);
assert.equal(n.sourceHistory.length, 3);
assert.equal(n.source.quote, 'Dataset A');
assert.equal(n.sourceNeedsReview, false);
const legacy = p.state.notes.find((n) => n.blockId && !n.source);
if (legacy) {
  p = await api(root, {
    ...payload,
    id: legacy.id,
    parseHash: s.hash,
    revision: p.revision,
    reason: 'Explicitly migrate synthetic legacy note source.',
  });
  const migrated = p.state.notes.find((n) => n.id === legacy.id);
  assert.equal(migrated.sourceHistory[0].source, undefined);
  assert.equal(migrated.text, legacy.text);
}
const report = {
  requestsPassed: calls,
  projectId,
  paperId: paper.id,
  noteId,
  verifiedAt: new Date().toISOString(),
};
writeFileSync(
  'outputs/v2-validation/note-source-api.json',
  JSON.stringify(report, null, 2),
);
console.log(report);
