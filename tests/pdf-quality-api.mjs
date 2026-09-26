// Verifies the PDF uploaded through the browser; uses only the named synthetic fixture.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error('Local only');
const { projectId } = JSON.parse(
  readFileSync('outputs/v2-validation/bibliography-fixture-id.json', 'utf8'),
);
const path = `/api/projects/${projectId}`;
const headers = { cookie: '__sites_local_auth=1', Connection: 'close' };
let calls = 0;
async function api(url, body, status = 200, authenticated = true) {
  const response = await fetch(base + url, {
    headers: {
      ...(authenticated ? headers : {}),
      ...(body && !(body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
    },
    ...(body
      ? {
          method: 'POST',
          body: body instanceof FormData ? body : JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  calls++;
  assert.equal(response.status, status, JSON.stringify(data));
  return data;
}
const { project } = await api(path);
assert.equal(project.question, 'Synthetic bibliography import verification.');
const paper = project.state.papers.find(
  (p) => p.filename === 'pdf-quality-fixture.pdf',
);
assert.ok(paper, 'Upload the synthetic PDF through the browser first.');
const { blocks } = await api(path + '/papers/' + paper.id);
const hash = (value) => createHash('sha256').update(value).digest('hex');
assert.equal(paper.parsing.hash, hash(JSON.stringify(blocks)));
assert.equal(paper.parsing.engine, 'pdfjs-layout-v2');
assert.equal(paper.pages, 3);
assert.deepEqual(
  paper.parsing.pages.map((p) => p.issues),
  [[], ['no-text'], ['sparse-text', 'rotated-text']],
);
assert.equal(paper.parsing.pages[0].layout, 'two-column');
assert.deepEqual(
  blocks.filter((b) => b.page === 1).map((b) => b.text.split('\n')[0]),
  [
    'Synthetic PDF parsing verification - not research data',
    'LEFT 1: Synthetic method text for reading order.',
    'RIGHT 1: Synthetic result text for reading order.',
    'Full width section heading for the second band',
    'LOW LEFT 1: Another synthetic method paragraph.',
    'LOW RIGHT 1: Another synthetic result paragraph.',
  ],
);
assert.ok(
  blocks[1].rect[2] < blocks[2].rect[0],
  'Highlights must not cross columns',
);
assert.equal(blocks.filter((b) => b.page === 2).length, 0);
const raw = await fetch(base + path + '/papers/' + paper.id + '?raw=1', {
  headers,
});
calls++;
assert.equal(raw.status, 200);
assert.equal(hash(Buffer.from(await raw.arrayBuffer())), paper.hash);
await api(path + '/papers/' + paper.id, undefined, 401, false);
const answer = await api(path + '/ai', {
  task: 'ask',
  mode: 'excerpts',
  paperIds: [paper.id],
  question: 'Synthetic method',
});
assert.equal(answer.coverage[0].mode, 'incomplete');
assert.deepEqual(answer.coverage[0].parsing.missingPages, [2]);
assert.equal(answer.coverage[0].parsing.qualityWarnings.length, 3);
assert.ok(answer.sources.every((s) => s.page !== 2));
assert.equal(answer.statements.length, 0);

const bytes = readFileSync('outputs/v2-validation/pdf-quality-fixture.pdf');
const valid = {
  engine: 'pdfjs-layout-v2',
  pages: paper.parsing.pages.map(({ page, layout, rotated }) => ({
    page,
    layout,
    rotated,
  })),
};
function form(
  report,
  revision = project.revision,
  pages = 3,
  contents = blocks,
) {
  const data = new FormData();
  data.set(
    'file',
    new File([bytes, '\n% synthetic rejected upload\n'], 'invalid-report.pdf', {
      type: 'application/pdf',
    }),
  );
  data.set('revision', String(revision));
  data.set('pageCount', String(pages));
  data.set('blocks', JSON.stringify(contents));
  data.set(
    'parsing',
    typeof report === 'string' ? report : JSON.stringify(report),
  );
  return data;
}
for (const report of [
  '{invalid',
  { ...valid, pages: valid.pages.slice(0, 2) },
  { ...valid, pages: [valid.pages[0], valid.pages[0], valid.pages[2]] },
  { ...valid, pages: [...valid.pages].reverse() },
  { ...valid, engine: 'plain-text-v1' },
  {
    ...valid,
    pages: valid.pages.map((p) => ({ ...p, characters: 9000, issues: [] })),
  },
  {
    ...valid,
    pages: valid.pages.map((p) => ({ ...p, layout: 'ocr-verified' })),
  },
  'x'.repeat(20001),
])
  await api(path + '/documents', form(report), 400);
await api(path + '/documents', form(valid, project.revision - 1), 409);
await api(path + '/documents', form(valid, project.revision, 2), 400);
const emptyLegacy = form(valid, project.revision, 3, []);
emptyLegacy.delete('parsing');
await api(path + '/documents', emptyLegacy, 400);
await api(path + '/documents', form(valid), 401, false);
assert.deepEqual(
  (await api(path)).project,
  project,
  'Rejected uploads must not mutate state',
);
const report = {
  requestsPassed: calls,
  projectId,
  paperId: paper.id,
  parseHash: paper.parsing.hash,
  verifiedAt: new Date().toISOString(),
};
writeFileSync(
  'outputs/v2-validation/pdf-quality-api.json',
  JSON.stringify(report, null, 2),
);
console.log(report);
