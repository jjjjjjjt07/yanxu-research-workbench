// Reuse the named local synthetic fixture. No model calls or real project changes.
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
const originalGraphRevision = g.revision;
const evidence = structuredClone(
  g.evidence.find(
    (e) =>
      p.state.papers.find((paper) => paper.id === e.paperId)?.filename ===
      'parse-versions-fixture.txt',
  ),
);
assert.ok(evidence);
const s = await api(`${root}/papers/${evidence.paperId}/parsing`);
assert.equal(s.hash, evidence.parseHash);
assert.ok(
  s.blocks.find((b) => b.id === evidence.blockId).text.includes(evidence.quote),
);
const prior = {
  oldText: p.state.review.oldText,
  newText: p.state.review.newText,
  feedback: p.state.review.feedback,
};
const draft = 'The synthetic method uses Dataset A.';
let noteId, citationId, exportId;
try {
  p = await api(root, {
    action: 'review.save',
    revision: p.revision,
    oldText: '',
    newText: draft,
    feedback: 'Synthetic graph-source verification.',
  });
  const input = (target = 'note') => ({
    action: 'evidence.toRecord',
    id: evidence.id,
    revision: g.revision,
    projectRevision: p.revision,
    target,
    text:
      target === 'note' ? 'Synthetic observation from graph evidence.' : draft,
    reason: 'Compared graph excerpt with the original.',
    manuscriptVersionId: p.state.review.versions.at(-1).id,
  });
  await api(root + '/graph', { ...input(), reason: '' }, 400);
  await api(root + '/graph', { ...input(), id: 'missing' }, 404);
  await api(root + '/graph', { ...input(), revision: g.revision - 1 }, 409);
  await api(
    root + '/graph',
    { ...input(), projectRevision: p.revision - 1 },
    409,
  );
  await api(
    root + '/graph',
    { ...input('manuscript'), manuscriptVersionId: 'wrong' },
    409,
  );
  await api(
    root + '/graph',
    { ...input('manuscript'), text: 'Invented manuscript sentence.' },
    400,
  );
  await api(root + '/graph', input(), 401, 'PATCH', false);
  assert.deepEqual((await api(root)).project, p);
  assert.deepEqual((await api(root + '/graph')).graph, g);

  const oldRevision = p.revision,
    oldGraphRevision = g.revision;
  g = await api(root + '/graph', input());
  p = (await api(root)).project;
  assert.equal(g.revision, oldGraphRevision + 1);
  assert.equal(p.revision, oldRevision + 1);
  const note = structuredClone(p.state.notes.at(-1));
  noteId = note.id;
  assert.deepEqual(note.source.graphEvidence, {
    id: evidence.id,
    graphRevision: oldGraphRevision,
  });
  assert.equal(note.sourceNeedsReview, undefined);
  assert.equal(note.source.quote, evidence.quote);
  g = await api(root + '/graph', input('manuscript'));
  p = (await api(root)).project;
  const citation = structuredClone(p.state.review.citations.at(-1));
  citationId = citation.id;
  assert.equal(citation.source.graphEvidence.id, evidence.id);
  assert.equal(citation.status, 'linked');
  const linkedGraphRevision = g.revision,
    contextVersion = p.state.contextVersion;

  g = await api(root + '/graph', {
    action: 'evidence.correct',
    id: evidence.id,
    quote: 'Dataset A',
    reason: 'Synthetic excerpt correction.',
    revision: g.revision,
  });
  p = (await api(root)).project;
  assert.deepEqual(
    p.state.notes.find((n) => n.id === noteId),
    { ...note, sourceNeedsReview: true },
  );
  assert.deepEqual(
    p.state.review.citations.find((c) => c.id === citationId),
    { ...citation, status: 'stale' },
  );
  assert.equal(p.state.contextVersion, contextVersion + 1);
  g = await api(root + '/graph', {
    action: 'graph.restore',
    targetRevision: linkedGraphRevision,
    revision: g.revision,
  });
  p = (await api(root)).project;
  assert.equal(
    p.state.notes.find((n) => n.id === noteId).sourceNeedsReview,
    true,
  );
  assert.equal(
    p.state.review.citations.find((c) => c.id === citationId).status,
    'stale',
  );

  p = await api(root, {
    action: 'note.source',
    revision: p.revision,
    id: noteId,
    blockId: evidence.blockId,
    parseHash: s.hash,
    quote: 'Dataset A',
    reason: 'Recheck directly against original.',
  });
  p = await api(root, {
    action: 'review.citation.save',
    revision: p.revision,
    sourceRevision: p.revision,
    id: citationId,
    manuscriptVersionId: p.state.review.versions.at(-1).id,
    manuscriptText: draft,
    paperId: evidence.paperId,
    blockId: evidence.blockId,
    parseHash: s.hash,
    quote: 'Dataset A',
    reason: 'Recheck directly against original.',
  });
  assert.equal(
    p.state.notes.find((n) => n.id === noteId).source.graphEvidence,
    undefined,
  );
  assert.equal(
    p.state.notes.find((n) => n.id === noteId).sourceHistory.at(-1).source
      .graphEvidence.id,
    evidence.id,
  );
  assert.equal(
    p.state.review.citations.find((c) => c.id === citationId).source
      .graphEvidence,
    undefined,
  );
  assert.equal(
    p.state.review.citations.find((c) => c.id === citationId).history.at(-1)
      .binding.source.graphEvidence.id,
    evidence.id,
  );
  const detachedProject = structuredClone(p);
  g = await api(root + '/graph', {
    action: 'evidence.correct',
    id: evidence.id,
    quote: 'Dataset A',
    reason: 'Verify detached records are unaffected.',
    revision: g.revision,
  });
  p = (await api(root)).project;
  assert.deepEqual(p, detachedProject);

  // A normalized graph quote is accepted in the graph but cannot become a fabricated verbatim source.
  g = await api(root + '/graph', {
    action: 'evidence.correct',
    id: evidence.id,
    quote: 'dataset a',
    reason: 'Synthetic case normalization.',
    revision: g.revision,
  });
  await api(root + '/graph', input(), 400);
  assert.deepEqual((await api(root)).project, p);
  assert.deepEqual((await api(root + '/graph')).graph, g);
  const exp = await api(root + '/exports', {}, 201, 'POST');
  exportId = exp.id;
  const bundle = await api(root + '/exports?download=' + exp.id);
  assert.deepEqual(
    bundle.files
      .find((f) => f.name === 'project.json')
      .content.state.notes.find((n) => n.id === noteId),
    p.state.notes.find((n) => n.id === noteId),
  );
  assert.deepEqual(
    bundle.files
      .find((f) => f.name === 'project.json')
      .content.state.review.citations.find((c) => c.id === citationId),
    p.state.review.citations.find((c) => c.id === citationId),
  );
} finally {
  g = (await api(root + '/graph')).graph;
  await api(root + '/graph', {
    action: 'graph.restore',
    targetRevision: originalGraphRevision,
    revision: g.revision,
  });
  p = (await api(root)).project;
  await api(root, { action: 'review.save', revision: p.revision, ...prior });
}
const report = {
  requestsPassed: calls,
  projectId,
  noteId,
  citationId,
  exportId,
  verifiedAt: new Date().toISOString(),
};
writeFileSync(
  'outputs/v2-validation/graph-records-api.json',
  JSON.stringify(report, null, 2),
);
console.log(report);
