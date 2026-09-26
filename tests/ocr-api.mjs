// Local synthetic scan only. One real model call; reuses a named test project.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error('Local only');
const headers = { cookie: '__sites_local_auth=1', Connection: 'close' };
let calls = 0;
async function api(
  path,
  body,
  status = 200,
  method = body ? 'POST' : 'GET',
  auth = true,
) {
  const r = await fetch(base + path, {
    method,
    headers: {
      ...(auth ? headers : {}),
      ...(body instanceof FormData
        ? {}
        : { 'Content-Type': 'application/json' }),
    },
    ...(body
      ? { body: body instanceof FormData ? body : JSON.stringify(body) }
      : {}),
  });
  const data = await r.json();
  calls++;
  assert.equal(r.status, status, JSON.stringify(data));
  return data;
}
const { projectId } = JSON.parse(
  readFileSync('outputs/v2-validation/parse-versions-fixture-id.json', 'utf8'),
);
const path = `/api/projects/${projectId}`;
let { project: p } = await api(path);
assert.equal(p.question, 'Synthetic parse version verification.');
let paper = p.state.papers.find((p) => p.filename === 'ocr-scan-fixture.pdf');
if (!paper) {
  const form = new FormData();
  form.set(
    'file',
    new File(
      [readFileSync('outputs/v2-validation/ocr-scan-fixture.pdf')],
      'ocr-scan-fixture.pdf',
      { type: 'application/pdf' },
    ),
  );
  form.set('revision', String(p.revision));
  form.set('pageCount', '1');
  form.set('blocks', '[]');
  form.set(
    'parsing',
    JSON.stringify({
      engine: 'pdfjs-layout-v2',
      pages: [{ page: 1, layout: 'single', rotated: false }],
    }),
  );
  p = await api(path + '/documents', form, 201);
  paper = p.state.papers.find((p) => p.filename === 'ocr-scan-fixture.pdf');
}
const route = `${path}/papers/${paper.id}`,
  parsing = route + '/parsing';
const hash = (b) => createHash('sha256').update(b).digest('hex');
const original = Buffer.from(
  await (await fetch(base + route + '?raw=1', { headers })).arrayBuffer(),
);
assert.equal(
  hash(original),
  hash(readFileSync('outputs/v2-validation/ocr-scan-fixture.pdf')),
);
let s = await api(parsing);
assert.deepEqual(s.blocks, [], 'Restore original scan before re-running');
assert.deepEqual(paper.parsing.pages[0].issues, ['no-text']);
const body = {
  revision: s.revision,
  hash: s.hash,
  page: 1,
  image:
    'data:image/png;base64,' +
    readFileSync('outputs/v2-validation/pdf-quality-page-2.png').toString(
      'base64',
    ),
};
await api(route + '/ocr', { ...body, revision: s.revision - 1 }, 409);
await api(route + '/ocr', { ...body, page: 2 }, 400);
await api(
  route + '/ocr',
  { ...body, image: 'data:image/png;base64,AAAA' },
  400,
);
await api(route + '/ocr', body, 401, 'POST', false);
console.log('Running one real DeepSeek V4.1 Flash OCR request…');
const preview = await api(route + '/ocr', body);
writeFileSync(
  'outputs/v2-validation/ocr-preview.json',
  JSON.stringify(preview, null, 2),
);
assert.equal(preview.model, 'deepseek-flash');
assert.match(
  preview.blocks.map((b) => b.text).join(' '),
  /Synthetic image.only page.*No text layer/is,
);
assert.deepEqual(await api(parsing), s, 'Preview must not mutate parse');
const accept = {
  action: 'acceptOcr',
  previewId: preview.id,
  revision: s.revision,
  hash: s.hash,
  reason: 'Compared synthetic page with visible text.',
};
await api(parsing, { ...accept, reason: '' }, 400, 'PATCH');
await api(
  parsing,
  { ...accept, previewId: '00000000-0000-4000-8000-000000000000' },
  404,
  'PATCH',
);
p = (await api(parsing, accept, 200, 'PATCH')).project;
s = await api(parsing);
assert.deepEqual(s.blocks, preview.blocks);
assert.equal(s.versions.at(-1).ocr.model, 'deepseek-flash');
assert.ok(
  p.state.papers
    .find((p) => p.id === paper.id)
    .parsing.pages[0].issues.includes('ocr-text'),
);
await api(parsing, accept, 409, 'PATCH');
const acceptedId = s.currentVersionId;
p = (
  await api(
    parsing,
    {
      action: 'restore',
      versionId: 'original',
      revision: s.revision,
      hash: s.hash,
      reason: 'Restore empty scan baseline to verify reversibility.',
    },
    200,
    'PATCH',
  )
).project;
s = await api(parsing);
assert.deepEqual(s.blocks, []);
assert.equal(s.versions.at(-1).restoredFrom, 'original');
await api(
  parsing,
  { ...accept, revision: s.revision, hash: s.hash },
  409,
  'PATCH',
);
const historic = await api(parsing + '?version=' + acceptedId);
assert.deepEqual(historic.blocks, preview.blocks);
const rawAfter = Buffer.from(
  await (await fetch(base + route + '?raw=1', { headers })).arrayBuffer(),
);
assert.deepEqual(rawAfter, original);
const report = {
  requestsPassed: calls,
  projectId,
  paperId: paper.id,
  model: preview.model,
  text: preview.blocks.map((b) => b.text),
  rawHash: hash(original),
  verifiedAt: new Date().toISOString(),
};
writeFileSync(
  'outputs/v2-validation/ocr-api.json',
  JSON.stringify(report, null, 2),
);
console.log(report);
