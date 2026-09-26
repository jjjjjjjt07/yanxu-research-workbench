// Opt-in paid integration test, local only. Uses three explicitly synthetic papers.
import assert from 'node:assert/strict';
import { runBatch } from '../lib/batch.ts';
import { waitForJob } from './wait-jobs.mjs';
const base = 'http://localhost:3000';
let checks = 0;
async function api(path, body, method = 'POST', expected = 200) {
  const r = await fetch(base + path, {
    method: body === undefined ? 'GET' : method,
    headers: {
      cookie: '__sites_local_auth=1',
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
  const data = await r.json();
  assert.equal(r.status, expected, path + ': ' + JSON.stringify(data));
  checks++;
  return data;
}
let p = await api(
  '/api/projects',
  {
    title: '多文献回归 · CPU 小样本图像识别',
    question: '',
    profile: {
      equipment: '只有 CPU，8 GB 内存，300 张标注图像，无 GPU',
      currentMethod: 'Baseline-A',
      constraints: '不可新增标注数据，推理小于 100 ms',
    },
  },
  'POST',
  201,
);
const materials = [
  [
    'Alpha',
    '虚构材料 Alpha。方法 CpuNet 使用 CPU 完成图像分类。',
    '数据集 Demo-A 训练集有 4800 张图像，独立测试集为 1200 张图像。准确率 90%，单张推理耗时 50 ms。',
  ],
  [
    'Beta',
    '虚构材料 Beta。方法 GpuNet 依赖 GPU，训练需 10000 张标注图像。',
    '数据集 Demo-B 独立测试集为 800 张图像，准确率 95%，单张推理耗时 30 ms。',
  ],
  [
    'Gamma',
    '虚构材料 Gamma。方法 SmallNet 使用 CPU，以 200 张标注图像训练。',
    '数据集 Demo-C 独立测试集为 300 张图像，准确率 88%，单张推理耗时 80 ms。',
  ],
];
for (const [name, ...blocks] of materials) {
  const form = new FormData();
  form.append(
    'file',
    new File([blocks.join('\n\n')], name + '.txt', { type: 'text/plain' }),
  );
  form.append('revision', String(p.revision));
  form.append(
    'blocks',
    JSON.stringify(blocks.map((text, i) => ({ id: String(i), page: 1, text }))),
  );
  p = await api(`/api/projects/${p.id}/documents`, form, 'POST', 201);
}
const ids = p.state.papers.map((x) => x.id);
const queued = await api(`/api/projects/${p.id}/extract`, {}, 'POST', 201);
assert.equal(queued.jobs.length, 3);
const batch = await runBatch(queued.jobs, async (id) => {
  await api(`/api/jobs/${id}`, { action: 'run' });
  await waitForJob(api, p.id, id);
});
assert.equal(batch.succeeded, 3, JSON.stringify(batch.failures));
p = (await api(`/api/projects/${p.id}`)).project;
const sampleField = p.state.fields.find((f) => f.name === '测试样本量');
for (const [i, expected] of ['1200', '800', '300'].entries()) {
  const cell = p.state.cells.find(
    (c) => c.paperId === ids[i] && c.fieldId === sampleField.id,
  );
  assert.ok(cell.value.includes(expected));
  assert.equal(cell.sourceValid, true);
}
console.log(
  JSON.stringify({ phase: 'three-paper extraction passed', projectId: p.id }),
);
async function mutate(body) {
  p = await api(
    `/api/projects/${p.id}`,
    { ...body, revision: p.revision },
    'PATCH',
  );
}
await mutate({
  action: 'note.add',
  paperId: ids[2],
  blockId: '',
  text: 'SmallNet 已在本机尝试，实测推理 180 ms，超过课题上限 100 ms。',
});
await mutate({
  action: 'reading.feedback',
  paperIds: [ids[2]],
  text: 'SmallNet 作为当前部署候选',
  status: 'unsuitable',
  reason: '本机实测 180 ms，超过 100 ms 上限，应先优化再考虑。',
});
// A reload verifies that profile and feedback survive beyond the action response.
p = (await api(`/api/projects/${p.id}`)).project;
assert.equal(
  p.state.profile.equipment,
  '只有 CPU，8 GB 内存，300 张标注图像，无 GPU',
);
assert.equal(p.state.readingFeedback[0].status, 'unsuitable');
const question =
  '我的课题是什么？请比较这三篇论文的独立测试集样本量，并结合我的设备、数据条件、已有笔记和反馈，说明哪些方案不适用及原因。';
const answer = await api(`/api/projects/${p.id}/ai`, {
  task: 'ask',
  paperIds: ids,
  question,
});
assert.equal(answer.context.title, p.title);
assert.equal(answer.context.noteCount, 1);
assert.equal(answer.context.feedbackCount, 1);
assert.equal(answer.coverage.length, 3);
assert.equal(new Set(answer.sources.map((s) => s.paperId)).size, 3);
assert.ok(answer.statements.length > 0);
assert.ok(answer.statements.every((s) => s.needsReview === true));
assert.ok(
  answer.statements.every(
    (s) => s.support === 'unknown' || s.sourceIndices.length > 0,
  ),
);
for (const n of ['1200', '800', '300', '180'])
  assert.ok(answer.answer.includes(n), 'missing ' + n);
assert.match(answer.answer, /CPU/);
console.log(
  JSON.stringify({
    phase: 'multi-paper context and feedback passed',
    answer: answer.answer,
    sources: answer.sources.map((s) => ({ paper: s.paperTitle, page: s.page })),
  }),
);
const follow = await api(`/api/projects/${p.id}/ai`, {
  task: 'ask',
  paperIds: ids,
  question:
    '你上次回答中，哪个方法的本机实测超过了时延限制？这个信息来自论文还是我的记录？',
  history: [{ question, answer: answer.answer }],
});
assert.match(follow.answer, /SmallNet/);
assert.match(follow.answer, /180/);
assert.match(follow.answer, /记录|笔记|反馈/);
const subset = await api(`/api/projects/${p.id}/ai`, {
  task: 'ask',
  paperIds: ids.slice(1),
  question: '比较这两篇论文的测试集样本量。',
});
assert.equal(subset.coverage.length, 2);
assert.ok(subset.sources.every((s) => ids.slice(1).includes(s.paperId)));
assert.equal(new Set(subset.sources.map((s) => s.paperId)).size, 2);
await api(
  `/api/projects/${p.id}/ai`,
  { task: 'ask', paperIds: ['foreign-paper'], question: 'test' },
  'POST',
  400,
);
await api(
  `/api/projects/${p.id}/ai`,
  { task: 'ask', paperIds: ids, blockId: 'bad', question: 'test' },
  'POST',
  400,
);
// Exercise the SAME client batch runner with a real failed first request.
const retryQueue = await api(
  `/api/projects/${p.id}/extract`,
  { fieldIds: [sampleField.id] },
  'POST',
  201,
);
await api(`/api/jobs/${retryQueue.jobs[0]}`, { action: 'cancel' });
const recovery = await runBatch(retryQueue.jobs, async (id) => {
  await api(`/api/jobs/${id}`, { action: 'run' });
  await waitForJob(api, p.id, id);
});
assert.equal(recovery.failures.length, 1);
assert.equal(recovery.succeeded, 2);
const reloaded = await api(`/api/projects/${p.id}`);
assert.ok(
  retryQueue.jobs
    .slice(1)
    .every(
      (id) => reloaded.jobs.find((j) => j.id === id)?.status === 'succeeded',
    ),
);
p = reloaded.project;
await mutate({
  action: 'reading.feedback',
  ...p.state.readingFeedback[0],
  status: 'tried',
  reason: '已优化至 90 ms，准备再次比较。',
});
assert.equal(p.state.readingFeedback[0].status, 'tried');
await mutate({
  action: 'reading.feedback.remove',
  id: p.state.readingFeedback[0].id,
});
assert.equal(p.state.readingFeedback.length, 0);
console.log(
  JSON.stringify({
    passed: true,
    checks,
    projectId: p.id,
    phases: [
      'three extractions',
      'all-paper comparison',
      'project title with empty question',
      'persisted profile and feedback',
      'follow-up',
      'two-paper subset',
      'invalid scope rejected',
      'failure recovery',
      'feedback update/remove',
    ],
  }),
);
