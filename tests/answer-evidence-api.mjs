// Reuse the named local fixture; no model calls, no real research modifications.
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
let { graph: g } = await api(root + '/graph');
const initialGraphRevision = g.revision;
const paper = p.state.papers.find(
  (p) => p.filename === 'parse-versions-fixture.txt',
);
const evidence = g.evidence.find((e) => e.paperId === paper.id);
assert.ok(evidence);
const parsing = `${root}/papers/${paper.id}/parsing`;
let s = await api(parsing);
assert.equal(s.hash, evidence.parseHash);
assert.equal(s.blocks[0].text, evidence.quote);
const parseVersion = s.currentVersionId,
  originalText = s.blocks[0].text;
const response = await api(
  root + '/ai',
  {
    task: 'ask',
    mode: 'excerpts',
    paperIds: [paper.id],
    question: `Synthetic graph-linked answer ${Date.now()}: Dataset A?`,
  },
  200,
  'POST',
);
assert.ok(response.savedAnswerId);
const answerId = response.savedAnswerId;
const entry = async () =>
  (await api(root + '/answers')).records.find((r) => r.id === answerId);
let record = await entry();
assert.equal(record.status.needsReview, false);
assert.deepEqual(record.graphLinks, []);
const originalResult = structuredClone(record.result);
const { status: _status, graphLinks: _links, ...immutableRecord } = record;
const input = () => ({
  action: 'link',
  answerId,
  sourceIndex: 0,
  evidenceId: evidence.id,
  projectRevision: p.revision,
  graphRevision: g.revision,
  reason: 'Synthetic human source comparison.',
});
async function refresh() {
  p = (await api(root)).project;
  g = (await api(root + '/graph')).graph;
}
let exportId;
try {
  await api(root + '/answers', { ...input(), reason: '' }, 400);
  await api(root + '/answers', { ...input(), sourceIndex: 999 }, 400);
  await api(
    root + '/answers',
    { ...input(), answerId: '../other-project' },
    400,
  );
  await api(
    root + '/answers',
    {
      ...input(),
      answerId: '0000000000000-00000000-0000-4000-8000-000000000000',
    },
    404,
  );
  await api(root + '/answers', { ...input(), evidenceId: 'missing' }, 404);
  await api(
    root + '/answers',
    { ...input(), projectRevision: p.revision - 1 },
    409,
  );
  await api(
    root + '/answers',
    { ...input(), graphRevision: g.revision - 1 },
    409,
  );
  await api(root + '/answers', { ...input(), action: 'withdraw' }, 400);
  await api(root + '/answers', input(), 401, 'PATCH', false);
  await api(
    '/api/projects/00000000-0000-4000-8000-000000000000/answers',
    input(),
    404,
  );
  assert.deepEqual((await api(root)).project, p);
  assert.deepEqual((await api(root + '/graph')).graph, g);
  const oldProjectRevision = p.revision,
    oldGraphRevision = g.revision;
  const firstInput = input();
  await api(root + '/answers', firstInput);
  await api(root + '/answers', firstInput, 409);
  await refresh();
  assert.equal(p.revision, oldProjectRevision + 1);
  assert.equal(g.revision, oldGraphRevision + 1);
  record = await entry();
  assert.equal(record.status.needsReview, false);
  assert.equal(record.graphLinks[0].source.graphEvidence.id, evidence.id);
  assert.equal(record.graphLinks[0].status, 'linked');
  assert.deepEqual(record.result, originalResult);
  const link = structuredClone(record.graphLinks[0]);

  g = await api(root + '/graph', {
    action: 'evidence.correct',
    id: evidence.id,
    quote: 'Dataset A',
    reason: 'Synthetic correction.',
    revision: g.revision,
  });
  await refresh();
  record = await entry();
  assert.equal(record.status.graphSourceChanged, true);
  assert.equal(record.status.needsReview, true);
  assert.deepEqual(record.graphLinks[0], { ...link, status: 'stale' });
  assert.deepEqual(record.result, originalResult);
  await api(root + '/answers', input(), 400);
  g = await api(root + '/graph', {
    action: 'graph.restore',
    targetRevision: initialGraphRevision,
    revision: g.revision,
  });
  await refresh();
  assert.equal((await entry()).graphLinks[0].status, 'stale');
  await api(root + '/answers', input());
  await refresh();
  record = await entry();
  assert.equal(record.graphLinks[0].status, 'linked');
  assert.equal(record.graphLinks[0].history.at(-1).status, 'stale');
  await api(root + '/answers', {
    ...input(),
    action: 'withdraw',
    reason: 'Synthetic withdrawal.',
  });
  await refresh();
  await api(root + '/answers', { ...input(), action: 'withdraw' }, 400);
  assert.equal((await entry()).graphLinks[0].status, 'withdrawn');
  await api(root + '/answers', input());
  await refresh();
  assert.equal(
    (await entry()).graphLinks[0].history.at(-1).status,
    'withdrawn',
  );

  s = await api(parsing);
  await api(parsing, {
    action: 'correct',
    revision: p.revision,
    hash: s.hash,
    blockId: s.blocks[0].id,
    text: originalText.replace('Dataset A', 'Dataset B'),
    reason: 'Synthetic answer-link parse change.',
  });
  await refresh();
  assert.equal((await entry()).graphLinks[0].status, 'stale');
  s = await api(parsing);
  await api(parsing, {
    action: 'restore',
    revision: p.revision,
    hash: s.hash,
    versionId: parseVersion,
    reason: 'Restore synthetic source.',
  });
  await refresh();
  // Equal restored text still has a new parse version: a historical answer cannot be freshened.
  await api(root + '/answers', input(), 409);
  record = await entry();
  assert.equal(record.graphLinks[0].status, 'stale');
  assert.equal(record.status.needsReview, true);
  assert.deepEqual(record.result, originalResult);
  const exp = await api(root + '/exports', {}, 201, 'POST');
  exportId = exp.id;
  const bundle = await api(root + '/exports?download=' + exportId);
  const saved = bundle.files.find((f) =>
    f.name.endsWith('/' + answerId + '.json'),
  );
  assert.ok(saved, 'Original answer is exported');
  assert.deepEqual(saved.content, immutableRecord);
  assert.deepEqual(
    bundle.files
      .find((f) => f.name === 'project.json')
      .content.state.answerEvidenceLinks.find((l) => l.answerId === answerId),
    record.graphLinks[0],
  );
} finally {
  await refresh();
  s = await api(parsing);
  if (s.blocks[0].text !== originalText) {
    await api(parsing, {
      action: 'restore',
      revision: p.revision,
      hash: s.hash,
      versionId: parseVersion,
      reason: 'Restore test fixture after failure.',
    });
    await refresh();
  }
  await api(root + '/graph', {
    action: 'graph.restore',
    targetRevision: initialGraphRevision,
    revision: g.revision,
  });
}
const report = {
  requestsPassed: calls,
  projectId,
  answerId,
  exportId,
  verifiedAt: new Date().toISOString(),
};
writeFileSync(
  'outputs/v2-validation/answer-evidence-api.json',
  JSON.stringify(report, null, 2),
);
console.log(report);
