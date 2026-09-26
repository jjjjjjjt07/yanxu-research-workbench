// Local-only, synthetic metadata. Creates one isolated project; never invokes a model.
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const base = process.env.TEST_BASE_URL || 'http://localhost:3000';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  throw new Error('Local only');
const headers = {
  cookie: '__sites_local_auth=1',
  'Content-Type': 'application/json',
  Connection: 'close',
};
let calls = 0;
async function api(path, body, status = 200, method = body ? 'POST' : 'GET') {
  const response = await fetch(base + path, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  assert.equal(response.status, status, JSON.stringify(result));
  calls++;
  return result;
}
let project = await api(
  '/api/projects',
  {
    title: `V2 bibliography fixture ${Date.now()}`,
    question: 'Synthetic bibliography import verification.',
  },
  201,
);
const path = `/api/projects/${project.id}`,
  route = path + '/bibliography';
mkdirSync('outputs/v2-validation', { recursive: true });
writeFileSync(
  'outputs/v2-validation/bibliography-fixture-id.json',
  JSON.stringify({ projectId: project.id }),
);
const bib =
  '@article{a,title={Synthetic Abstract},author={Doe, Jane},year=2024,doi={10.1234/BIB},abstract={Method A uses Dataset X.}}\n@article{dup,title={Duplicate DOI},doi={https://doi.org/10.1234/bib}}\n@misc{metadata,title={Metadata only}}\n@misc{bad,doi={10.1234/missingtitle}}';
const payload = (action, text = bib, format = 'bibtex') => ({
  action,
  text,
  format,
  filename: `synthetic.${format === 'endnote' ? 'xml' : format}`,
  revision: project.revision,
});
const preview = await api(route, payload('preview'));
assert.equal(preview.entries.length, 4);
assert.ok(preview.entries[1].duplicate);
assert.ok(preview.entries[3].error);
assert.equal((await api(path)).project.revision, project.revision);
await api(
  route,
  { ...payload('import'), hash: preview.hash, selected: [0, 1] },
  400,
);
await api(
  route,
  { ...payload('import'), hash: preview.hash, selected: [0, 3] },
  400,
);
await api(
  route,
  { ...payload('import'), hash: preview.hash, selected: [0, 0] },
  400,
);
await api(
  route,
  { ...payload('import'), hash: preview.hash, selected: [999] },
  400,
);
await api(
  route,
  { ...payload('import', bib + '\n'), hash: preview.hash, selected: [0] },
  409,
);
assert.deepEqual((await api(path)).project.state.papers, []);
project = (
  await api(
    route,
    { ...payload('import'), hash: preview.hash, selected: [0, 2] },
    201,
  )
).project;
assert.equal(project.state.papers.length, 2);
const abstract = project.state.papers[0],
  metadata = project.state.papers[1];
assert.equal(abstract.coverage, 'abstract');
assert.equal(metadata.coverage, 'metadata');
assert.equal(metadata.metadata.doi, '');
const material = await api(path + '/papers/' + abstract.id);
assert.equal(
  material.blocks.map((b) => b.text).join(''),
  'Method A uses Dataset X.',
);
await api(path + '/graph', { task: 'extract', paperIds: [metadata.id] }, 400);
const record = project.state.bibliographyImports[0];
const source = await fetch(base + route + '?id=' + record.id, { headers });
assert.equal(source.status, 200);
const raw = await source.text();
assert.equal(raw, bib);
assert.equal(createHash('sha256').update(raw).digest('hex'), record.hash);
calls++;
assert.equal((await fetch(base + route + '?id=' + record.id)).status, 401);
calls++;
await api(route + '?id=not-in-project', undefined, 404);
await api(
  route,
  {
    ...payload('import'),
    revision: preview.revision,
    hash: preview.hash,
    selected: [0],
  },
  409,
);
const duplicate = await api(route, payload('preview'));
assert.ok(duplicate.entries[0].duplicate);
const ris =
  'TY  - JOUR\nTI  - RIS sample\nAU  - Smith, Ada\nDO  - 10.1234/ris\nER  -';
const risPreview = await api(route, payload('preview', ris, 'ris'));
project = (
  await api(
    route,
    { ...payload('import', ris, 'ris'), hash: risPreview.hash, selected: [0] },
    201,
  )
).project;
const xml =
  '<xml><records><record><ref-type>17</ref-type><titles><title>XML sample</title></titles><abstract>XML abstract source.</abstract><electronic-resource-num>10.1234/xml</electronic-resource-num></record></records></xml>';
const xmlPreview = await api(route, payload('preview', xml, 'endnote'));
project = (
  await api(
    route,
    {
      ...payload('import', xml, 'endnote'),
      hash: xmlPreview.hash,
      selected: [0],
    },
    201,
  )
).project;
assert.equal(project.state.papers[2].metadata.provider, 'RIS');
assert.equal(project.state.papers[3].metadata.provider, 'EndNote XML');
await api(route, payload('preview', 'TY  - JOUR\nTI  - broken', 'ris'), 400);
await api(route, payload('preview', '<!DOCTYPE xml><xml/>', 'endnote'), 400);
const savedRevision = project.revision;
const tooMany = Array.from(
  { length: 17 },
  (_, i) => `@misc{n${i},title={Extra ${i}}}`,
).join('\n');
const many = await api(route, payload('preview', tooMany));
await api(
  route,
  {
    ...payload('import', tooMany),
    hash: many.hash,
    selected: many.entries.map((e) => e.index),
  },
  400,
);
assert.equal((await api(path)).project.revision, savedRevision);
const bundle = await api(path + '/exports', {}, 201);
const download = await fetch(base + path + '/exports?download=' + bundle.id, {
  headers,
});
assert.equal(download.status, 200);
const pack = await download.json();
assert.equal(
  pack.files.filter((f) => f.name.startsWith('bibliography/')).length,
  3,
);
assert.equal(
  pack.files.find((f) => f.name === `bibliography/${record.id}.json`).content
    .text,
  bib,
);
calls++;
writeFileSync(
  'outputs/v2-validation/bibliography-api.json',
  JSON.stringify(
    {
      projectId: project.id,
      calls,
      revision: project.revision,
      at: new Date().toISOString(),
      modelInvoked: false,
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ passed: calls, projectId: project.id }));
