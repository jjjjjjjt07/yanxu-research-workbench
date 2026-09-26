// Opt-in integration test: four workflows, including paid semantic verification calls.
// 仅允许在本地运行；本文件不内置任何远程部署地址或授权凭据。
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { waitForJob } from './wait-jobs.mjs';
const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
const local = ['localhost', '127.0.0.1'].includes(new URL(base).hostname);
if (!local)
  throw new Error(
    '本测试只允许本地运行：请把 TEST_BASE_URL 指向 localhost 或 127.0.0.1。',
  );
const headers = { cookie: '__sites_local_auth=1' };
async function api(path, body, method = 'POST') {
  const r = await fetch(base + path, {
    method: body === undefined ? 'GET' : method,
    redirect: 'manual',
    headers: {
      ...headers,
      ...(body instanceof FormData
        ? {}
        : { 'Content-Type': 'application/json' }),
    },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
    signal: AbortSignal.timeout(110000),
  });
  const raw = await r.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`${path}: HTTP ${r.status}, non-JSON response`);
  }
  assert.ok(
    r.ok,
    `${path}: HTTP ${r.status}: ${data.error || 'request failed'}`,
  );
  return data;
}
const settings = await api('/api/projects');
assert.equal(settings.ai.configured, true);
let p = await api('/api/projects', {
  title: 'AI 功能验收（测试资料） ' + new Date().toISOString().slice(0, 16),
  question: '比较图像分类方法，测试样本量仅统计独立测试集。',
});
console.log(
  JSON.stringify({
    phase: 'created',
    projectId: p.id,
    model: settings.ai.model,
  }),
);
const text = await readFile(
  new URL('../sample-data/ai-test-paper.txt', import.meta.url),
  'utf8',
);
const form = new FormData();
form.append(
  'file',
  new File([text], 'ai-test-paper.txt', { type: 'text/plain' }),
);
form.append('revision', String(p.revision));
form.append(
  'blocks',
  JSON.stringify(
    text
      .trim()
      .split(/\r?\n\r?\n/)
      .map((text, i) => ({ id: String(i), page: 1, text })),
  ),
);
p = await api(`/api/projects/${p.id}/documents`, form);
const paper = p.state.papers[0];
const queued = await api(`/api/projects/${p.id}/extract`, {
  paperIds: [paper.id],
});
for (const id of queued.jobs) {
  await api(`/api/jobs/${id}`, { action: 'run' });
  await waitForJob(api, p.id, id);
}
p = (await api(`/api/projects/${p.id}`)).project;
const sampleField = p.state.fields.find((f) => f.name === '测试样本量');
const conditionField = p.state.fields.find((f) => f.name === '实验条件');
const sample = p.state.cells.find((c) => c.fieldId === sampleField.id);
const condition = p.state.cells.find((c) => c.fieldId === conditionField.id);
assert.match(sample.value, /1200/);
assert.doesNotMatch(sample.value, /4800|6000/);
assert.equal(sample.sourceValid, true);
assert.equal(sample.origin, 'ai');
assert.equal(condition.status, 'unknown');
console.log(
  JSON.stringify({
    phase: 'extraction passed',
    sample: sample.value,
    missingConditions: condition.status,
  }),
);
const answer = await api(`/api/projects/${p.id}/ai`, {
  task: 'ask',
  paperId: paper.id,
  question: '独立测试集有多少张图像？请与训练集区分。',
});
assert.match(answer.answer, /1200/);
assert.ok(answer.sources.length > 0);
const citedTestSet = answer.statements?.find(
  (statement) => /独立测试集.*1200/.test(statement.text),
);
assert.equal(citedTestSet?.kind, 'fact');
assert.equal(citedTestSet?.support, 'supported');
assert.ok(
  citedTestSet.sourceIndices.some((index) =>
    answer.sources[index]?.quote.includes('1200'),
  ),
);
console.log(
  JSON.stringify({ phase: 'cited answer passed', answer: answer.answer }),
);
const missing = await api(`/api/projects/${p.id}/ai`, {
  task: 'ask',
  paperId: paper.id,
  question: '论文使用的显卡型号和显存分别是多少？只依据原文回答。',
});
assert.match(missing.answer, /未|无法|没有|不明确|不足/);
assert.doesNotMatch(missing.answer, /RTX\s?4090|A100/);
console.log(
  JSON.stringify({
    phase: 'missing information passed',
    answer: missing.answer,
  }),
);
p = await api(
  `/api/projects/${p.id}`,
  {
    action: 'review.save',
    revision: p.revision,
    oldText: '我们对模型进行了测试。',
    newText:
      '我们使用独立测试集中的 1200 张图像评估模型，训练集包含 4800 张图像。',
    feedback: '请明确独立测试集的样本量，并与训练集区分。',
  },
  'PATCH',
);
p = await api(`/api/projects/${p.id}/ai`, {
  task: 'review',
  revision: p.revision,
});
assert.ok(p.state.review.items.length > 0);
assert.ok(p.state.review.items.some((i) => i.evidence.includes('1200')));
for (const item of p.state.review.items) {
  assert.notEqual(item.status, 'done');
  if (item.evidence) assert.ok(p.state.review.newText.includes(item.evidence));
}
console.log(
  JSON.stringify({ phase: 'review passed', items: p.state.review.items }),
);
const after = await api('/api/projects');
console.log(
  JSON.stringify({
    passed: 4,
    projectId: p.id,
    model: after.ai.model,
    usage: after.usage,
  }),
);
