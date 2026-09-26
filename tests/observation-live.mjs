// One synthetic question through the configured model plus its support-check call.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const { projectId, observationId } = JSON.parse(
  readFileSync('outputs/v2-validation/observation-citations-api.json', 'utf8'),
);
const root = `${base}/api/projects/${projectId}`;
const headers = {
  cookie: '__sites_local_auth=1',
  'Content-Type': 'application/json',
  Connection: 'close',
};
const { project } = await (await fetch(root, { headers })).json();
assert.equal(project.question, 'Synthetic parse version verification.');
assert.equal(
  project.state.observations.find((o) => o.id === observationId).status,
  'recorded',
);
const paper = project.state.papers.find(
  (p) => p.filename === 'parse-versions-fixture.txt',
);
const response = await fetch(root + '/ai', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    task: 'ask',
    mode: 'analysis',
    paperIds: [paper.id],
    observationIds: [observationId],
    question:
      '仅根据我选择的用户实验观察，方法A记录的数值是多少？明确标注来自用户实验记录和观察索引，不将其写成论文结论；不要推断统计显著性。',
  }),
});
const result = await response.json();
assert.equal(response.status, 200, JSON.stringify(result));
assert.ok(result.savedAnswerId);
assert.equal(result.observations[0].id, observationId);
const observed = result.statements.filter((s) => s.observationIndices?.length);
for (const s of result.statements)
  if (s.kind === 'unknown') assert.equal(s.support, 'unknown');
assert.ok(observed.length, 'Model must cite the selected observation');
for (const s of observed) {
  assert.deepEqual(s.observationIndices, [0]);
  assert.notEqual(s.kind, 'fact');
  assert.notEqual(s.support, 'supported');
}
assert.match(observed.map((s) => s.text).join(' '), /90/);
const history = await (await fetch(root + '/answers', { headers })).json();
const record = history.records.find((r) => r.id === result.savedAnswerId);
assert.equal(record.model, 'deepseek-flash');
assert.equal(record.status.needsReview, false);
const report = {
  model: record.model,
  answerId: record.id,
  statementCount: result.statements.length,
  observationStatementCount: observed.length,
  verifiedAt: new Date().toISOString(),
  result,
};
writeFileSync(
  'outputs/v2-validation/observation-live.json',
  JSON.stringify(report, null, 2),
);
console.log({
  model: report.model,
  answerId: report.answerId,
  statementCount: report.statementCount,
  observationStatementCount: report.observationStatementCount,
});
