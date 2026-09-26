import assert from 'node:assert/strict';
const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error(
    'This integration suite is restricted to the local development server.',
  );
let count = 0;
async function api(path, options = {}, expected = 200) {
  const r = await fetch(base + path, {
    ...options,
    headers: {
      cookie: '__sites_local_auth=1',
      ...(options.body instanceof FormData
        ? {}
        : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
  });
  const raw = await r.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { error: raw };
  }
  assert.equal(r.status, expected, path + ' ' + JSON.stringify(data));
  count++;
  return data;
}
const unauth = await fetch(base + '/api/projects');
assert.equal(unauth.status, process.env.TEST_LOCAL_ACCESS === '1' ? 200 : 401);
count++;
let p = await api(
  '/api/projects',
  {
    method: 'POST',
    body: JSON.stringify({
      title: 'Integration test ' + Date.now(),
      question: 'API regression test',
    }),
  },
  201,
);
const projectId = p.id;
async function mutate(body, expected = 200) {
  const out = await api(
    `/api/projects/${projectId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ revision: p.revision, ...body }),
    },
    expected,
  );
  if (expected === 200) p = out;
  return out;
}
const text =
  'Test material only.\n\nThe training set has 4800 images. The independent test set contains 1200 images.\n\nMethod A accuracy on Dataset X is 92 percent.';
const form = new FormData();
form.append(
  'file',
  new File([text], 'test-material.txt', { type: 'text/plain' }),
);
form.append('revision', String(p.revision));
form.append(
  'blocks',
  JSON.stringify(
    text.split('\n\n').map((text, i) => ({ id: String(i), page: 1, text })),
  ),
);
p = await api(
  `/api/projects/${projectId}/documents`,
  { method: 'POST', body: form },
  201,
);
assert.equal(p.state.papers.length, 1);
assert.equal(p.state.cells.length, 5);
const paper = p.state.papers[0];
const material = await api(`/api/projects/${projectId}/papers/${paper.id}`);
assert.equal(material.blocks[1].page, 1);
const original = await fetch(
  `${base}/api/projects/${projectId}/papers/${paper.id}?raw=1`,
  { headers: { cookie: '__sites_local_auth=1' } },
);
assert.equal(await original.text(), text);
count++;
await api(`/api/projects/${projectId}/papers/does-not-exist`, {}, 404);
const cell = p.state.cells[2],
  block = material.blocks[1];
await mutate({
  action: 'cell.edit',
  id: cell.id,
  value: '1200',
  reason: 'Verified independent test set',
  blockId: block.id,
  quote: 'The independent test set contains 1200 images.',
});
assert.equal(p.state.cells[2].sourceValid, true);
assert.equal(p.state.cells[2].status, 'confirmed');
await mutate({
  action: 'rule.add',
  fieldId: cell.fieldId,
  instruction: 'Only count the independent test set.',
});
assert.equal(p.state.cells[2].status, 'stale');
assert.equal(p.state.cells[2].value, '1200');
await api(
  `/api/projects/${projectId}`,
  {
    method: 'PATCH',
    body: JSON.stringify({
      revision: 1,
      action: 'project.edit',
      title: 'must not overwrite',
      question: '',
    }),
  },
  409,
);
await mutate({
  action: 'field.save',
  name: 'Source code',
  definition: 'Only report a code URL explicitly present in the document.',
});
assert.equal(p.state.cells.length, 6);
await mutate({
  action: 'experiment.save',
  name: 'Result comparison',
  filename: 'first.csv',
  direction: 'higher',
  rows: [
    { method: 'A', dataset: 'X', metric: 'accuracy', value: 92 },
    { method: 'B', dataset: 'X', metric: 'accuracy', value: 90 },
  ],
});
const exp = p.state.experiments[0];
await mutate({
  action: 'claim.add',
  text: 'A has higher accuracy than B on X.',
  experimentId: exp.id,
  method: 'A',
  otherMethod: 'B',
  dataset: 'X',
  metric: 'accuracy',
  relation: 'higher',
  expected: null,
});
assert.equal(p.state.claims[0].result, 'pass');
await mutate({
  action: 'experiment.save',
  id: exp.id,
  name: 'Result comparison',
  filename: 'second.csv',
  direction: 'higher',
  rows: [
    { method: 'A', dataset: 'X', metric: 'accuracy', value: 88 },
    { method: 'B', dataset: 'X', metric: 'accuracy', value: 90 },
  ],
});
assert.equal(p.state.claims[0].result, 'fail');
assert.equal(p.state.claims[0].needsReview, true);
assert.equal(p.state.experiments[0].versions.length, 2);
await mutate({ action: 'claim.confirm', id: p.state.claims[0].id }, 400);
await mutate({
  action: 'review.save',
  oldText: 'We evaluated our model.',
  newText: 'We evaluated our model on an independent test set of 1200 images.',
  feedback: 'Specify the independent test set size.',
});
await mutate({ action: 'review.manual' });
assert.equal(p.state.review.items.length, 1);
const item = p.state.review.items[0];
await mutate(
  {
    action: 'review.item',
    id: item.id,
    status: 'done',
    confirmation: '',
    evidence: '',
  },
  400,
);
await mutate(
  {
    action: 'review.item',
    id: item.id,
    status: 'done',
    confirmation: 'Added the sample size.',
    evidence: 'invented evidence',
  },
  400,
);
await mutate({
  action: 'review.item',
  id: item.id,
  status: 'done',
  confirmation: 'Added the sample size and checked the data.',
  evidence: 'an independent test set of 1200 images.',
});
assert.equal(p.state.review.items[0].status, 'done');
await mutate({
  action: 'review.save',
  oldText: p.state.review.oldText,
  newText: p.state.review.newText + ' Further details are included.',
  feedback: 'Clarify the data split.',
});
assert.equal(p.state.review.history.length, 1);
assert.equal(p.state.review.history[0].items[0].status, 'done');
const reload = await api(`/api/projects/${projectId}`);
assert.equal(reload.project.revision, p.revision);
assert.equal(reload.project.state.cells[2].value, '1200');
await api(
  `/api/projects/${projectId}`,
  {
    method: 'PATCH',
    headers: { Origin: 'https://unrelated.invalid' },
    body: JSON.stringify({
      revision: p.revision,
      action: 'project.edit',
      title: 'blocked',
      question: '',
    }),
  },
  403,
);
const settings = await api('/api/projects');
if (!settings.ai.configured)
  await api(
    `/api/projects/${projectId}/extract`,
    { method: 'POST', body: '{}' },
    503,
  );
await api(
  '/api/jobs/nonexistent',
  { method: 'POST', body: JSON.stringify({ action: 'cancel' }) },
  404,
);
// A generated PDF fixture verifies the actual PDF.js extraction path without browser automation.
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
const stream =
  'BT /F1 12 Tf 50 750 Td (Independent test set: 1200 images.) Tj ET';
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
];
let pdf = '%PDF-1.4\n';
const offsets = [0];
objects.forEach((o, i) => {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
});
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
  .slice(1)
  .map((n) => String(n).padStart(10, '0') + ' 00000 n \n')
  .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
const task = getDocument({ data: new Uint8Array(Buffer.from(pdf)) });
const doc = await task.promise;
const page = await doc.getPage(1),
  content = await page.getTextContent();
const extracted = content.items
  .filter((i) => 'str' in i)
  .map((i) => i.str)
  .join(' ');
assert.ok(extracted.includes('1200 images'));
await task.destroy();
count++;
const pdfForm = new FormData();
pdfForm.append(
  'file',
  new File([pdf], 'fixture.pdf', { type: 'application/pdf' }),
);
pdfForm.append('revision', String(p.revision));
pdfForm.append(
  'blocks',
  JSON.stringify([
    {
      id: 'p1',
      page: 1,
      text: extracted,
      rect: [50, 30, 300, 45],
      width: 612,
      height: 792,
    },
  ]),
);
p = await api(
  `/api/projects/${projectId}/documents`,
  { method: 'POST', body: pdfForm },
  201,
);
assert.equal(p.state.papers[1].kind, 'pdf');
console.log(
  JSON.stringify({
    passed: count,
    projectId,
    revision: p.revision,
    modelTest: settings.ai.configured
      ? 'not invoked'
      : 'unconfigured gate passed',
  }),
);
