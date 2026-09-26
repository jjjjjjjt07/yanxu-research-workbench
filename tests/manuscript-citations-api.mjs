// Only the named local synthetic fixture; no model calls.
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
  method = body ? 'PATCH' : 'GET',
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
const prior = {
  oldText: p.state.review.oldText,
  newText: p.state.review.newText,
  feedback: p.state.review.feedback,
};
const paper = p.state.papers.find(
    (p) => p.filename === 'parse-versions-fixture.txt',
  ),
  parsing = `${root}/papers/${paper.id}/parsing`;
let s = await api(parsing);
const original = s.blocks[0].text,
  parseVersion = s.currentVersionId;
assert.match(original, /Dataset A/);
p = await api(root, {
  action: 'review.save',
  revision: p.revision,
  oldText: '',
  newText: 'The synthetic method uses Dataset A.',
  feedback: 'Verify the data source.',
});
const draftVersion = p.state.review.versions.at(-1).id;
const input = () => ({
  action: 'review.citation.save',
  revision: p.revision,
  sourceRevision: p.revision,
  manuscriptVersionId: p.state.review.versions.at(-1).id,
  manuscriptText: 'The synthetic method uses Dataset A.',
  paperId: paper.id,
  blockId: s.blocks[0].id,
  parseHash: s.hash,
  quote: 'Dataset A',
  reason: 'Synthetic test: compared manuscript and original.',
});
await api(root, { ...input(), reason: '' }, 400);
await api(root, { ...input(), manuscriptText: 'Invented draft sentence' }, 400);
await api(root, { ...input(), quote: 'Invented source' }, 400);
await api(root, { ...input(), sourceRevision: p.revision - 1 }, 409);
await api(root, { ...input(), manuscriptVersionId: 'wrong' }, 409);
await api(root, { ...input(), parseHash: '0'.repeat(64) }, 409);
await api(root, input(), 401, 'PATCH', false);
assert.deepEqual((await api(root)).project, p);
p = await api(root, input());
const id = p.state.review.citations.at(-1).id;
let citation = p.state.review.citations.find((c) => c.id === id);
const first = structuredClone(citation);
assert.equal(citation.source.quote, 'Dataset A');
assert.equal(citation.status, 'linked');
p = await api(root, {
  action: 'review.save',
  revision: p.revision,
  oldText: '',
  newText: 'Uses Dataset A. Uses Dataset A.',
  feedback: 'Verify.',
});
assert.equal(p.state.review.citations.find((c) => c.id === id).status, 'stale');
await api(root, { ...input(), id, manuscriptText: 'Uses Dataset A.' }, 400);
p = await api(root, {
  action: 'review.restore',
  id: draftVersion,
  revision: p.revision,
});
assert.equal(p.state.review.citations.find((c) => c.id === id).status, 'stale');
p = await api(root, { ...input(), id });
citation = p.state.review.citations.find((c) => c.id === id);
assert.equal(
  citation.history[0].binding.manuscriptVersionId,
  first.manuscriptVersionId,
);
assert.equal(citation.history[0].status, 'stale');
s = await api(parsing);
p = (
  await api(parsing, {
    action: 'correct',
    revision: p.revision,
    hash: s.hash,
    blockId: s.blocks[0].id,
    text: original.replace('Dataset A', 'Dataset B'),
    reason: 'Synthetic citation parse invalidation.',
  })
).project;
assert.equal(p.state.review.citations.find((c) => c.id === id).status, 'stale');
assert.equal(
  p.state.review.citations.find((c) => c.id === id).source.quote,
  'Dataset A',
);
s = await api(parsing);
await api(root, { ...input(), id }, 400);
p = (
  await api(parsing, {
    action: 'restore',
    revision: p.revision,
    hash: s.hash,
    versionId: parseVersion,
    reason: 'Restore synthetic original.',
  })
).project;
s = await api(parsing);
assert.equal(s.blocks[0].text, original);
assert.equal(p.state.review.citations.find((c) => c.id === id).status, 'stale');
p = await api(root, { ...input(), id });
await api(
  root,
  {
    action: 'review.citation.withdraw',
    id,
    revision: p.revision,
    sourceRevision: p.revision,
    reason: '',
  },
  400,
);
p = await api(root, {
  action: 'review.citation.withdraw',
  id,
  revision: p.revision,
  sourceRevision: p.revision,
  reason: 'Synthetic withdrawal test.',
});
assert.equal(
  p.state.review.citations.find((c) => c.id === id).status,
  'withdrawn',
);
const beforeWithdrawHistory = p.state.review.citations.find((c) => c.id === id)
  .history.length;
p = await api(root, {
  ...input(),
  id,
  reason: 'Explicitly rebind after withdrawal.',
});
citation = p.state.review.citations.find((c) => c.id === id);
assert.equal(citation.history.length, beforeWithdrawHistory + 1);
assert.equal(citation.history.at(-1).status, 'withdrawn');
const exp = await api(root + '/exports', {}, 201, 'POST');
const bundle = await api(root + '/exports?download=' + exp.id);
assert.deepEqual(
  bundle.files
    .find((f) => f.name === 'project.json')
    .content.state.review.citations.find((c) => c.id === id),
  citation,
);
p = await api(root, { action: 'review.save', revision: p.revision, ...prior });
assert.equal(p.state.review.citations.find((c) => c.id === id).status, 'stale');
const report = {
  requestsPassed: calls,
  projectId,
  citationId: id,
  exportId: exp.id,
  verifiedAt: new Date().toISOString(),
};
writeFileSync(
  'outputs/v2-validation/manuscript-citations-api.json',
  JSON.stringify(report, null, 2),
);
console.log(report);
