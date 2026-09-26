// Existing synthetic CSV fixture only; retains two versions and comparison history. No model calls.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const base = process.env.TEST_BASE_URL || 'http://localhost:3001';
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
  const r = await fetch(base + path, {
    method,
    headers: {
      ...(auth ? { cookie: '__sites_local_auth=1' } : {}),
      'Content-Type': 'application/json',
      Connection: 'close',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  calls++;
  assert.equal(r.status, status, JSON.stringify(data));
  return data;
}
let { project: p } = await api(root);
assert.equal(p.question, 'Synthetic parse version verification.');
const exp = p.state.experiments.find(
  (e) => e.name === 'Synthetic CSV source fixture',
);
assert.ok(
  exp && exp.versions.length <= 8,
  'Needs two version slots in the existing synthetic fixture',
);
const experimentId = exp.id,
  priorVersions = structuredClone(exp.versions);
const initialRows = exp.versions.at(-1).rows;
const initialA = initialRows.filter(
  (r) => r.method === 'A' && r.dataset === 'X' && r.metric === 'accuracy',
);
const initialB = initialRows.filter(
  (r) => r.method === 'B' && r.dataset === 'X' && r.metric === 'accuracy',
);
assert.ok(
  initialA.length >= 2 && initialB.length >= 2,
  'Needs the synthetic repeated-run groups',
);
const current = () => p.state.experiments.find((e) => e.id === experimentId);
const assumptions = {
  unit: 'synthetic points',
  samplingUnit: 'one independent synthetic run',
  conditions: 'fixed synthetic setup only',
  independent: true,
  independenceBasis: 'simulated independent runs for workflow test',
  approximateNormal: true,
  distributionBasis: 'declared synthetic normal data process',
  pairingConfirmed: false,
  pairingBasis: '',
};
const multiplicity = {
  kind: 'single',
  count: 1,
  plan: 'One predefined synthetic comparison.',
  confirmed: true,
};
const input = () => ({
  action: 'experiment.comparison',
  revision: p.revision,
  id: experimentId,
  versionId: current().versions.at(-1).id,
  methodA: 'A',
  methodB: 'B',
  dataset: 'X',
  metric: 'accuracy',
  design: 'welch',
  assumptions,
  multiplicity,
  reason: 'Synthetic comparison workflow.',
});
await api(
  root,
  { ...input(), assumptions: { ...assumptions, independent: false } },
  400,
);
await api(
  root,
  { ...input(), assumptions: { ...assumptions, approximateNormal: false } },
  400,
);
await api(root, { ...input(), assumptions: { ...assumptions, unit: '' } }, 400);
await api(
  root,
  { ...input(), multiplicity: { ...multiplicity, count: 2 } },
  400,
);
await api(
  root,
  { ...input(), multiplicity: { ...multiplicity, confirmed: false } },
  400,
);
await api(
  root,
  {
    ...input(),
    multiplicity: { ...multiplicity, kind: 'bonferroni', count: 101 },
  },
  400,
);
await api(
  root,
  { ...input(), multiplicity: { ...multiplicity, plan: '' } },
  400,
);
await api(root, { ...input(), reason: '' }, 400);
await api(root, { ...input(), methodB: 'A' }, 400);
await api(root, { ...input(), methodB: 'missing' }, 400);
await api(root, { ...input(), id: 'missing' }, 404);
await api(root, { ...input(), versionId: 'old' }, 409);
await api(root, { ...input(), revision: p.revision - 1 }, 409);
await api(root, input(), 401, 'PATCH', false);
await api(root, { ...input(), design: 'paired' }, 400);
const pairedAssumptions = {
  ...assumptions,
  pairingConfirmed: true,
  pairingBasis:
    'The same runId represents the same synthetic subject; independent pairs.',
};
if (
  initialA.length !== initialB.length ||
  initialA.some((a) => !initialB.some((b) => b.runId === a.runId))
) {
  await api(
    root,
    { ...input(), design: 'paired', assumptions: pairedAssumptions },
    400,
  );
}
assert.deepEqual((await api(root)).project, p);
const welchInput = input();
p = await api(root, { ...welchInput, rawP: 0 });
await api(root, welchInput, 409);
const initial = structuredClone(current().comparisons.at(-1));
assert.equal(initial.design, 'welch');
assert.equal(initial.sampleA.n, initialA.length);
assert.equal(initial.sampleB.n, initialB.length);
assert.ok(
  initial.rawP > 0 && initial.rawP <= 1,
  'Client-supplied p=0 is never used',
);
assert.deepEqual(current().versions, priorVersions);
const raw =
  'method,dataset,metric,value,runId\nA,X,accuracy,10,r1\nA,X,accuracy,12,r2\nA,X,accuracy,15,r3\nB,X,accuracy,11,r3\nB,X,accuracy,9,r1\nB,X,accuracy,9,r2\n';
p = await api(
  root + '/experiments',
  {
    revision: p.revision,
    id: experimentId,
    name: current().name,
    filename: 'synthetic-pairs.csv',
    direction: 'higher',
    origin: 'file',
    base64: Buffer.from(raw).toString('base64'),
  },
  201,
  'POST',
);
const pairedVersion = structuredClone(current().versions.at(-1));
assert.notEqual(initial.versionId, pairedVersion.id);
assert.deepEqual(
  current().comparisons.find((r) => r.id === initial.id),
  initial,
);
const pairInput = {
  ...input(),
  design: 'paired',
  assumptions: pairedAssumptions,
  multiplicity: {
    kind: 'bonferroni',
    count: 3,
    plan: 'All three prespecified synthetic contrasts.',
    confirmed: true,
  },
};
p = await api(root, pairInput);
await api(root, pairInput, 409);
const paired = structuredClone(current().comparisons.at(-1));
assert.deepEqual(
  paired.pairs.map((r) => r.indexB),
  [4, 5, 3],
);
assert.deepEqual(
  paired.pairs.map((r) => r.difference),
  [1, 3, 4],
);
assert.ok(Math.abs(paired.effect.value - 8 / 3) < 1e-12);
assert.equal(paired.df, 2);
assert.equal(paired.multiplicity.count, 3);
assert.equal(paired.adjustedP, Math.min(1, paired.rawP * 3));
assert.equal(paired.inputDataHash, pairedVersion.statistics.inputDataHash);
assert.deepEqual(paired.assumptions, pairedAssumptions);
p = await api(root, {
  action: 'experiment.reproducibility',
  revision: p.revision,
  id: experimentId,
  versionId: pairedVersion.id,
  metadata: { randomSeed: 'synthetic paired seeds documented by runId' },
  reason: 'Verify comparison version tracking.',
});
assert.notEqual(paired.versionId, current().versions.at(-1).id);
assert.deepEqual(
  current().comparisons.find((r) => r.id === paired.id),
  paired,
);
await api(root, { ...pairInput, revision: p.revision }, 409);
p = await api(root, {
  ...pairInput,
  revision: p.revision,
  versionId: current().versions.at(-1).id,
});
const renewed = structuredClone(current().comparisons.at(-1));
assert.notEqual(renewed.id, paired.id);
assert.equal(renewed.rawP, paired.rawP);
assert.equal(renewed.versionId, current().versions.at(-1).id);
assert.deepEqual(
  current().versions.slice(0, priorVersions.length),
  priorVersions,
);
assert.deepEqual(
  (await api(root)).project.state.experiments.find(
    (e) => e.id === experimentId,
  ),
  current(),
);
const exported = await api(root + '/exports', {}, 201, 'POST'),
  bundle = await api(root + '/exports?download=' + exported.id);
const captured = bundle.files
  .find((f) => f.name === 'project.json')
  .content.state.experiments.find((e) => e.id === experimentId);
assert.deepEqual(captured, current());
for (const record of [initial, paired, renewed]) {
  const version = captured.versions.find((v) => v.id === record.versionId);
  assert.equal(version.statistics.inputDataHash, record.inputDataHash);
  for (const pair of record.pairs ?? [])
    assert.equal(
      version.rows[pair.indexA].value - version.rows[pair.indexB].value,
      pair.difference,
    );
}
const result = {
  requestsPassed: calls,
  projectId,
  experimentId,
  comparisonIds: [initial.id, paired.id, renewed.id],
  exportId: exported.id,
  verifiedAt: new Date().toISOString(),
};
writeFileSync(
  'outputs/v2-validation/experiment-comparison-api.json',
  JSON.stringify(result, null, 2) + '\n',
);
console.log(JSON.stringify(result));
