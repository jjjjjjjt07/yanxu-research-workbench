// Existing local synthetic project only. Optional real-model check lives in a separate script.
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
let { project: p } = await api(root),
  { graph: g } = await api(root + '/graph');
assert.equal(p.question, 'Synthetic parse version verification.');
const experiment = p.state.experiments.find(
  (e) => e.name === 'Synthetic observation fixture',
);
assert.ok(experiment && experiment.versions.length <= 8);
const initialData = structuredClone(experiment.versions.at(-1));
const paper = p.state.papers.find(
  (p) => p.filename === 'parse-versions-fixture.txt',
);
const priorReview = {
  oldText: p.state.review.oldText,
  newText: p.state.review.newText,
  feedback: p.state.review.feedback,
};
const draft = 'Our synthetic method reached 90.';
let observationId,
  citationId,
  exportId,
  dataChanged = false,
  selectedAnswerId;
async function refresh() {
  p = (await api(root)).project;
  g = (await api(root + '/graph')).graph;
}
const observe = (extra = {}) => ({
  action: 'save',
  id: observationId,
  projectRevision: p.revision,
  graphRevision: g.revision,
  experimentId: experiment.id,
  experimentVersionId: p.state.experiments
    .find((e) => e.id === experiment.id)
    .versions.at(-1).id,
  rowIndices: [0, 1],
  text: 'Method A recorded 90 and Method B recorded 80.',
  conditions: 'Synthetic single-run data; no significance test.',
  outcome: 'inconclusive',
  reason: 'Compared selected experiment rows.',
  ...extra,
});
const cite = (extra = {}) => ({
  action: 'cite',
  id: citationId,
  observationId,
  projectRevision: p.revision,
  graphRevision: g.revision,
  manuscriptVersionId: p.state.review.versions.at(-1).id,
  text: draft,
  reason: 'Matched manuscript phrase to synthetic data.',
  ...extra,
});
const question = (ids) => ({
  task: 'ask',
  mode: 'excerpts',
  paperIds: [paper.id],
  question: `Synthetic observation reference ${Date.now()}?`,
  observationIds: ids,
});
const entry = async (id) =>
  (await api(root + '/answers')).records.find((r) => r.id === id);
const citation = () =>
  p.state.review.observationCitations.find((c) => c.id === citationId);
try {
  p = (await api(root + '/observations', observe())).project;
  observationId = p.state.observations.at(-1).id;
  g = (await api(root + '/graph')).graph;
  p = await api(root, {
    action: 'review.save',
    revision: p.revision,
    oldText: '',
    newText: draft,
    feedback: '',
  });
  const draftVersion = p.state.review.versions.at(-1).id;
  await api(root + '/observations', cite({ reason: '' }), 400);
  await api(root + '/observations', cite({ text: 'Invented sentence' }), 400);
  await api(root + '/observations', cite({ manuscriptVersionId: 'old' }), 409);
  await api(
    root + '/observations',
    cite({ projectRevision: p.revision - 1 }),
    409,
  );
  await api(
    root + '/observations',
    cite({ graphRevision: g.revision - 1 }),
    409,
  );
  await api(root + '/observations', cite({ observationId: 'missing' }), 400);
  await api(root + '/observations', cite(), 401, 'PATCH', false);
  await api(
    root + '/ai',
    question([observationId, observationId]),
    400,
    'POST',
  );
  await api(root + '/ai', question(['missing']), 409, 'POST');
  assert.deepEqual((await api(root)).project, p);
  const selected = await api(
    root + '/ai',
    question([observationId]),
    200,
    'POST',
  );
  selectedAnswerId = selected.savedAnswerId;
  const unrelated = await api(root + '/ai', question([]), 200, 'POST');
  assert.equal(
    selected.observations[0].snapshot.experiment.rows[0].value.value,
    90,
  );
  assert.equal(unrelated.observations, undefined);
  const originalAnswer = await entry(selectedAnswerId);
  assert.equal(originalAnswer.status.needsReview, false);
  assert.equal(
    originalAnswer.contextSnapshot.experimentObservations[0].interpretation.includes(
      '用户实验',
    ),
    true,
  );
  const oldRevision = p.revision,
    firstInput = cite();
  p = (await api(root + '/observations', firstInput)).project;
  assert.equal(p.revision, oldRevision + 1);
  citationId = p.state.review.observationCitations.at(-1).id;
  g = (await api(root + '/graph')).graph;
  await api(root + '/observations', firstInput, 409);
  const originalCitation = structuredClone(citation());
  p = (
    await api(
      root + '/observations',
      observe({ text: 'Revised interpretation, still inconclusive.' }),
    )
  ).project;
  g = (await api(root + '/graph')).graph;
  assert.equal(citation().status, 'stale');
  assert.deepEqual(citation().source, originalCitation.source);
  const history = await entry(selectedAnswerId);
  assert.equal(history.status.contextChanged, true);
  assert.deepEqual(history.status.staleObservationIds, [observationId]);
  assert.deepEqual(history.result, originalAnswer.result);
  assert.equal(
    (await entry(unrelated.savedAnswerId)).status.needsReview,
    false,
    'unselected observations do not invalidate unrelated answers',
  );
  p = (await api(root + '/observations', observe())).project;
  g = (await api(root + '/graph')).graph;
  assert.equal(citation().status, 'stale');
  assert.equal((await entry(selectedAnswerId)).status.needsReview, true);
  p = (await api(root + '/observations', cite())).project;
  g = (await api(root + '/graph')).graph;
  assert.equal(citation().history.at(-1).status, 'stale');
  const changedRows = structuredClone(initialData.rows);
  changedRows[0].value++;
  p = await api(root, {
    action: 'experiment.save',
    id: experiment.id,
    revision: p.revision,
    name: experiment.name,
    direction: experiment.direction,
    filename: initialData.filename,
    rows: changedRows,
  });
  dataChanged = true;
  assert.equal(citation().status, 'stale');
  await api(root + '/ai', question([observationId]), 409, 'POST');
  await api(root + '/observations', cite(), 400);
  p = await api(root, {
    action: 'experiment.save',
    id: experiment.id,
    revision: p.revision,
    name: experiment.name,
    direction: experiment.direction,
    filename: initialData.filename,
    rows: initialData.rows,
  });
  dataChanged = false;
  assert.equal(citation().status, 'stale');
  p = (await api(root + '/observations', observe())).project;
  g = (await api(root + '/graph')).graph;
  p = (await api(root + '/observations', cite())).project;
  g = (await api(root + '/graph')).graph;
  p = (
    await api(root + '/observations', {
      action: 'withdraw',
      id: observationId,
      projectRevision: p.revision,
      graphRevision: g.revision,
      reason: 'Withdraw observation.',
    })
  ).project;
  g = (await api(root + '/graph')).graph;
  assert.equal(citation().status, 'stale');
  await api(root + '/ai', question([observationId]), 409, 'POST');
  p = (await api(root + '/observations', observe())).project;
  g = (await api(root + '/graph')).graph;
  p = await api(root, {
    action: 'review.save',
    revision: p.revision,
    oldText: '',
    newText: draft + ' ' + draft,
    feedback: '',
  });
  await api(root + '/observations', cite(), 400);
  p = await api(root, {
    action: 'review.restore',
    revision: p.revision,
    id: draftVersion,
  });
  assert.equal(citation().status, 'stale');
  p = (await api(root + '/observations', cite())).project;
  g = (await api(root + '/graph')).graph;
  p = (
    await api(root + '/observations', {
      action: 'citation.withdraw',
      id: citationId,
      projectRevision: p.revision,
      graphRevision: g.revision,
      reason: 'Withdraw citation.',
    })
  ).project;
  g = (await api(root + '/graph')).graph;
  assert.equal(citation().status, 'withdrawn');
  p = (
    await api(
      root + '/observations',
      observe({ conditions: 'Synthetic data, no independent validation.' }),
    )
  ).project;
  g = (await api(root + '/graph')).graph;
  assert.equal(citation().status, 'withdrawn');
  p = (await api(root + '/observations', cite())).project;
  assert.equal(citation().history.at(-1).status, 'withdrawn');
  const exp = await api(root + '/exports', {}, 201, 'POST');
  exportId = exp.id;
  const bundle = await api(root + '/exports?download=' + exportId);
  assert.deepEqual(
    bundle.files
      .find((f) => f.name === 'project.json')
      .content.state.review.observationCitations.find(
        (c) => c.id === citationId,
      ),
    citation(),
  );
  assert.deepEqual(
    bundle.files.find((f) => f.name.endsWith('/' + selectedAnswerId + '.json'))
      .content.result,
    originalAnswer.result,
  );
} finally {
  await refresh();
  if (dataChanged)
    p = await api(root, {
      action: 'experiment.save',
      id: experiment.id,
      revision: p.revision,
      name: experiment.name,
      direction: experiment.direction,
      filename: initialData.filename,
      rows: initialData.rows,
    });
  await api(root, {
    action: 'review.save',
    revision: p.revision,
    ...priorReview,
  });
}
const report = {
  requestsPassed: calls,
  projectId,
  observationId,
  citationId,
  selectedAnswerId,
  exportId,
  verifiedAt: new Date().toISOString(),
};
writeFileSync(
  'outputs/v2-validation/observation-citations-api.json',
  JSON.stringify(report, null, 2),
);
console.log(report);
