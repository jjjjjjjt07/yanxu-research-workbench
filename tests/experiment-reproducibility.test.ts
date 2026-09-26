import test from 'node:test';
import assert from 'node:assert/strict';
import type { Experiment } from '../lib/domain';
import { emptyState } from '../lib/domain.ts';
import {
  reproducibilitySchema,
  missingReproducibility,
  saveReproducibility,
} from '../lib/experiment-reproducibility.ts';
import { captureExperiment, saveObservation } from '../lib/observations.ts';
import { observationContext } from '../lib/observation-reference.ts';
const experiment = (): Experiment => ({
  id: 'e',
  name: 'Test',
  direction: 'higher',
  versions: [
    {
      id: 'v1',
      at: 't1',
      filename: 'input.csv',
      rows: [{ method: 'A', dataset: 'X', metric: 'accuracy', value: 90 }],
    },
  ],
});
await test('reproducibility creates an audited immutable version and preserves result values', async () => {
  const exp = experiment(),
    before = structuredClone(exp.versions[0]);
  const metadata = reproducibilitySchema.parse({
    codeRevision: 'abc',
    codeHash: 'A'.repeat(64),
    inputDataHash: 'b'.repeat(64),
  });
  const saved = await saveReproducibility(
    exp,
    'v1',
    metadata,
    'human',
    'Compared run records',
  );
  assert.deepEqual(exp.versions[0], before);
  assert.deepEqual(saved.rows, before.rows);
  assert.notEqual(saved.rows, before.rows);
  assert.equal(saved.reproducibility.sourceVersionId, 'v1');
  assert.equal(saved.reproducibility.resultDataHash.length, 64);
  assert.equal(saved.reproducibility.metadata.codeHash, 'a'.repeat(64));
  await assert.rejects(
    saveReproducibility(exp, 'v1', metadata, 'human', 'Old version'),
  );
  assert.equal(exp.versions.length, 2);
});
void test('missing information stays missing, hash syntax is checked, and no-code records can mark code fields inapplicable', () => {
  assert.equal(missingReproducibility().length, 11);
  assert.throws(() => reproducibilitySchema.parse({ codeHash: 'invented' }));
  const record = {
    metadata: reproducibilitySchema.parse({ workingTree: 'modified' }),
    actor: '',
    at: '',
    reason: '',
    sourceVersionId: '',
    resultDataHash: '',
  };
  assert.ok(missingReproducibility(record).includes('未提交差异'));
  record.metadata.workingTree = 'not_applicable';
  assert.equal(missingReproducibility(record).includes('代码SHA-256'), false);
});
await test('observation snapshots keep run metadata, while question context omits raw uncommitted code', async () => {
  const exp = experiment(),
    state = emptyState();
  const metadata = reproducibilitySchema.parse({
    workingTree: 'modified',
    uncommittedDiff: 'synthetic code change',
    randomSeed: '42',
  });
  const version = await saveReproducibility(
    exp,
    'v1',
    metadata,
    'human',
    'Recorded run',
  );
  state.experiments.push(exp);
  const snapshot = await captureExperiment(exp, version.id, [0]);
  const observation = saveObservation(state, {
    text: 'Synthetic result',
    conditions: 'Test',
    outcome: 'inconclusive',
    experiment: snapshot,
    actor: 'human',
    at: 't',
    reason: 'Compared',
  });
  assert.equal(
    observation.experiment.reproducibility?.metadata.randomSeed,
    '42',
  );
  const context = observationContext(state, [observation.id]);
  assert.equal(
    JSON.stringify(context).includes('synthetic code change'),
    false,
  );
  assert.equal(
    JSON.stringify(context).includes('uncommittedDiffRecorded'),
    true,
  );
  assert.equal(
    observation.experiment.reproducibility?.metadata.uncommittedDiff,
    'synthetic code change',
  );
  await assert.rejects(
    saveReproducibility(
      exp,
      version.id,
      { ...metadata, workingTree: 'clean' },
      'human',
      'Conflict',
    ),
  );
});
