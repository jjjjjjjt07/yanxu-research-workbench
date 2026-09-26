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
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(auth ? { cookie: '__sites_local_auth=1' } : {}),
      'Content-Type': 'application/json',
      Connection: 'close',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  calls++;
  assert.equal(response.status, status, JSON.stringify(data));
  return data;
}

let { project } = await api(root);
let { graph } = await api(root + '/graph');
const experiment = project.state.experiments.find(
  (e) => e.id === 'f4c1867c-8950-4097-85e7-54878ea7df2a',
);
assert.ok(experiment);
const version = experiment.versions.at(-1);
const calculation = experiment.comparisons
  .filter((r) => r.versionId === version.id)
  .toSorted((a, b) => b.at.localeCompare(a.at))[0];
assert.ok(calculation && calculation.pairs?.length === 3);
const before = structuredClone(project);
const observationReason =
  'Verified calculation reference through the local API.';
const request = (extra) => ({
  action: 'save',
  projectRevision: project.revision,
  graphRevision: graph.revision,
  experimentId: experiment.id,
  experimentVersionId: version.id,
  rowIndices: [],
  calculation: { kind: 'comparison', id: calculation.id, confirmed: true },
  text: 'The saved paired comparison remained inconclusive after the recorded correction.',
  conditions:
    'Synthetic calculation fixture; only under the saved assumptions and comparison plan.',
  outcome: 'inconclusive',
  reason: observationReason,
  ...extra,
});

await api(
  root + '/observations',
  request({ calculation: { kind: 'comparison', id: calculation.id } }),
  400,
);
await api(
  root + '/observations',
  request({
    calculation: { kind: 'comparison', id: 'missing', confirmed: true },
  }),
  400,
);
await api(root + '/observations', request({ rowIndices: [0] }), 400);
await api(root + '/observations', request(), 401, 'PATCH', false);
assert.deepEqual(
  (await api(root)).project,
  before,
  'rejected requests must not mutate the project',
);

let observation = project.state.observations.find(
  (o) =>
    o.reason === observationReason &&
    o.calculation?.record.id === calculation.id,
);
if (!observation) {
  project = (await api(root + '/observations', request())).project;
  observation = project.state.observations.at(-1);
} else project = (await api(root)).project;
assert.equal(observation.calculation.kind, 'comparison');
assert.deepEqual(observation.calculation.record, calculation);
assert.deepEqual(
  observation.experiment.rows.map((r) => r.index),
  [0, 1, 2, 3, 4, 5],
);
assert.deepEqual(
  observation.calculation.record.pairs.map((p) => p.difference),
  [1, 3, 4],
);
graph = (await api(root + '/graph')).graph;

const paper = project.state.papers.find(
  (p) => p.filename === 'parse-versions-fixture.txt',
);
assert.ok(paper);
const answer = await api(
  root + '/ai',
  {
    task: 'ask',
    mode: 'excerpts',
    paperIds: [paper.id],
    question:
      'Show the source context alongside the selected synthetic calculation observation.',
    observationIds: [observation.id],
  },
  200,
  'POST',
);
assert.deepEqual(
  answer.observations[0].snapshot.calculation.record,
  calculation,
);
const answers = await api(root + '/answers');
const saved = answers.records.find((r) => r.id === answer.savedAnswerId);
assert.deepEqual(
  saved.contextSnapshot.experimentObservations[0].calculation.record,
  calculation,
);
assert.match(
  saved.contextSnapshot.experimentObservations[0].calculationValidation,
  /算术与输入血缘/,
);
assert.equal(saved.status.needsReview, false);

const priorReview = {
  oldText: project.state.review.oldText,
  newText: project.state.review.newText,
  feedback: project.state.review.feedback,
};
const citationReason =
  'Verified manuscript binding preserves the calculation snapshot.';
let citation = project.state.review.observationCitations.find(
  (c) => c.reason === citationReason && c.source.id === observation.id,
);
if (!citation) {
  let manuscriptText = project.state.review.newText.trim();
  let restoreReview = false;
  if (!manuscriptText || manuscriptText.length > 3000) {
    manuscriptText =
      'This synthetic manuscript sentence is linked to a saved calculation record.';
    project = await api(root, {
      action: 'review.save',
      revision: project.revision,
      oldText: priorReview.oldText,
      newText: manuscriptText,
      feedback: priorReview.feedback,
    });
    restoreReview = true;
  }
  project = (
    await api(root + '/observations', {
      action: 'cite',
      observationId: observation.id,
      projectRevision: project.revision,
      graphRevision: graph.revision,
      manuscriptVersionId: project.state.review.versions.at(-1).id,
      text: manuscriptText,
      reason: citationReason,
    })
  ).project;
  citation = project.state.review.observationCitations.at(-1);
  assert.equal(citation.status, 'linked');
  if (restoreReview)
    project = await api(root, {
      action: 'review.save',
      revision: project.revision,
      ...priorReview,
    });
}
assert.deepEqual(citation.source.snapshot.calculation.record, calculation);

const report = {
  requestsPassed: calls,
  projectId,
  experimentId: experiment.id,
  calculationId: calculation.id,
  observationId: observation.id,
  answerId: answer.savedAnswerId,
  citationId: citation.id,
  verifiedAt: new Date().toISOString(),
};
writeFileSync(
  'outputs/v2-validation/calculation-reference-api.json',
  JSON.stringify(report, null, 2),
);
console.log(report);
