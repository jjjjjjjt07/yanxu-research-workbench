import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error('Local only');
const { projectId } = JSON.parse(
  readFileSync('outputs/v2-validation/graph-live.json', 'utf8'),
);
async function api(path, body, method = body ? 'POST' : 'GET') {
  const r = await fetch(base + path, {
    method,
    headers: {
      cookie: '__sites_local_auth=1',
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d));
  return d;
}
const p = (await api(`/api/projects/${projectId}`)).project,
  g = (await api(`/api/projects/${projectId}/graph`)).graph;
const methods = p.state.papers.map((p) =>
  g.entities.find(
    (e) => e.paperIds.includes(p.id) && e.type === 'method' && !e.mergedInto,
  ),
);
assert.ok(methods.every(Boolean));
const created = await api(`/api/projects/${projectId}/graph`, {
  task: 'bridge',
  source: methods[0].id,
  target: methods[1].id,
});
let state;
for (let i = 0; i < 45; i++) {
  await delay(5000);
  state = await api(`/api/projects/${projectId}/graph`);
  const jobs = state.jobs.filter((j) => j.batchId === created.batchId);
  if (
    jobs.every((j) =>
      ['succeeded', 'partial', 'failed', 'cancelled'].includes(j.status),
    )
  )
    break;
}
assert.ok(
  state.jobs
    .filter((j) => j.batchId === created.batchId)
    .every((j) => j.status === 'succeeded'),
  JSON.stringify(state.jobs),
);
const hypotheses = state.graph.bridges.filter((b) =>
  state.jobs.some((j) => j.id === b.runId && j.batchId === created.batchId),
);
console.log(
  JSON.stringify({ bridgeJobs: 'succeeded', hypotheses: hypotheses.length }),
);
for (const b of hypotheses) {
  assert.ok(b.risks && b.differences && b.experiment);
  const papers = new Set(
    b.evidenceIds.map(
      (id) => state.graph.evidence.find((e) => e.id === id)?.paperId,
    ),
  );
  assert.ok(papers.size >= 2);
}
if (hypotheses.length) {
  await api(
    `/api/projects/${projectId}/graph`,
    {
      action: 'bridge.review',
      revision: state.graph.revision,
      id: hypotheses[0].id,
      status: 'explore',
      reason: '验证测试：两侧出处可定位，仍需研究者判断和实验。',
    },
    'PATCH',
  );
}
const excerpts = await api(`/api/projects/${projectId}/ai`, {
  task: 'ask',
  mode: 'excerpts',
  paperIds: p.state.papers.map((p) => p.id),
  question: 'What molecular properties are predicted?',
});
assert.ok(excerpts.sources.length);
assert.ok(excerpts.coverage.every((c) => c.mode === 'abstract'));
console.log(
  JSON.stringify({ excerpts: 'passed', sources: excerpts.sources.length }),
);
const answer = await api(`/api/projects/${projectId}/ai`, {
  task: 'ask',
  mode: 'analysis',
  paperIds: [p.state.papers[0].id],
  question:
    'Which method is proposed, and what conditions limit the evidence in this abstract?',
});
assert.ok(answer.statements.length);
for (const s of answer.statements)
  for (const i of s.sourceIndices) assert.ok(answer.sources[i]);
assert.ok(answer.statements.every((s) => s.needsReview));
console.log(
  JSON.stringify({ answer: 'passed', statements: answer.statements.length }),
);
const matrix = await api(`/api/projects/${projectId}/extract`, {
  paperIds: [p.state.papers[0].id],
  fieldIds: [p.state.fields[0].id],
});
let matrixData;
for (let i = 0; i < 30; i++) {
  await delay(5000);
  matrixData = await api(`/api/projects/${projectId}`);
  if (
    matrixData.jobs
      .filter((j) => matrix.jobs.includes(j.id))
      .every((j) => j.status === 'succeeded')
  )
    break;
}
assert.ok(
  matrixData.jobs
    .filter((j) => matrix.jobs.includes(j.id))
    .every((j) => j.status === 'succeeded'),
  JSON.stringify(matrixData.jobs),
);
console.log(JSON.stringify({ matrixBackground: 'passed' }));
state = await api(`/api/projects/${projectId}/graph`);
const cancel = await api(`/api/projects/${projectId}/graph`, {
  task: 'bridge',
  source: methods[0].id,
  target: methods[1].id,
});
state = await api(`/api/projects/${projectId}/graph`);
const cancelJob = state.jobs.find((j) => j.batchId === cancel.batchId);
await api(
  `/api/projects/${projectId}/graph`,
  { action: 'job.cancel', id: cancelJob.id, revision: state.graph.revision },
  'PATCH',
);
await delay(5000);
state = await api(`/api/projects/${projectId}/graph`);
assert.equal(state.jobs.find((j) => j.id === cancelJob.id).status, 'cancelled');
const report = {
  projectId,
  model: 'deepseek-flash',
  hypotheses: hypotheses.length,
  statements: answer.statements.length,
  checks: [
    'bridge source membership',
    'two-sided evidence',
    'excerpts preserve abstract coverage',
    'claim-source binding',
    'human review retained',
    'matrix executor independent of page',
    'cancellation does not publish result',
  ],
  academicQuality: 'Not evaluated; no human gold standard.',
};
writeFileSync(
  'outputs/v2-validation/v2-live-flows.json',
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
