import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error('Local test server required.');
async function api(path, body, method = body ? 'POST' : 'GET') {
  const r = await fetch(base + path, {
    method,
    headers: {
      cookie: '__sites_local_auth=1',
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data));
  return data;
}
let p = await api('/api/projects', {
  title: '真实摘要构图验证 ' + new Date().toLocaleString('zh-CN'),
  question: '图神经网络如何用于分子性质预测？比较方法假设与适用条件。',
});
const found = await api(`/api/projects/${p.id}/search`, {
  action: 'search',
  query: 'graph neural network molecular property prediction',
});
p = found.project;
const works = found.record.results
  .filter((w) => w.abstract.length > 150)
  .slice(0, 2);
assert.equal(
  works.length,
  2,
  'Need two real abstracts; cannot fabricate literature.',
);
for (const work of works)
  p = (
    await api(`/api/projects/${p.id}/search`, {
      action: 'import',
      searchId: found.record.id,
      doi: work.doi,
    })
  ).project;
console.log(
  JSON.stringify({
    projectId: p.id,
    sources: works.map((w) => ({ title: w.title, doi: w.doi })),
    coverage: 'abstracts only',
  }),
);
await api(`/api/projects/${p.id}/graph`, {
  task: 'extract',
  paperIds: p.state.papers.map((x) => x.id),
});
const deadline = Date.now() + 600000;
let data;
while (Date.now() < deadline) {
  await delay(10000);
  data = await api(`/api/projects/${p.id}/graph`);
  console.log(
    JSON.stringify(
      data.jobs.map((j) => ({
        status: j.status,
        stage: j.stage,
        attempts: j.attempts,
      })),
    ),
  );
  if (
    data.jobs.every((j) =>
      ['succeeded', 'partial', 'failed', 'cancelled'].includes(j.status),
    )
  )
    break;
}
assert.ok(
  data.jobs.every((j) => ['succeeded', 'partial'].includes(j.status)),
  JSON.stringify(data.jobs),
);
assert.ok(data.graph.entities.length > 0);
assert.ok(data.graph.relations.length > 0);
for (const e of data.graph.evidence) {
  const source = await api(`/api/projects/${p.id}/papers/${e.paperId}`);
  const block = source.blocks.find((b) => b.id === e.blockId);
  assert.ok(block);
  assert.ok(
    block.text
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .toLowerCase()
      .includes(e.quote.normalize('NFKC').replace(/\s+/g, ' ').toLowerCase()),
  );
}
const report = {
  projectId: p.id,
  model: (await api('/api/projects')).ai.model,
  sources: works.map((w) => ({ title: w.title, doi: w.doi })),
  jobs: data.jobs,
  entities: data.graph.entities.length,
  relations: data.graph.relations.length,
  evidence: data.graph.evidence.length,
  scope:
    'Real abstracts, exact quote checks only; not a 20-paper human annotated quality benchmark.',
};
mkdirSync('outputs/v2-validation', { recursive: true });
writeFileSync(
  'outputs/v2-validation/graph-live.json',
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
