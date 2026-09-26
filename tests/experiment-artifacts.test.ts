import test from 'node:test';
import assert from 'node:assert/strict';
import type { Experiment } from '../lib/domain.ts';
import {
  addExperimentArtifact,
  decodeArtifact,
  recordIndependentReproduction,
} from '../lib/experiment-artifacts.ts';
import { captureExperiment } from '../lib/observations.ts';

function fixture(): Experiment {
  return {
    id: 'experiment',
    name: 'Artifact fixture',
    direction: 'higher',
    versions: [
      {
        id: 'v1',
        at: 'then',
        filename: 'result.csv',
        rows: [{ method: 'A', dataset: 'X', metric: 'score', value: 1 }],
      },
    ],
  };
}

async function add(
  experiment: Experiment,
  kind: 'code' | 'environment' | 'result',
) {
  return addExperimentArtifact(
    experiment,
    'v1',
    {
      kind,
      filename: `${kind}.txt`,
      note: `Synthetic ${kind} evidence.`,
      bytes: new TextEncoder().encode(kind),
    },
    'tester',
  );
}

void test('artifact bytes are bounded and metadata retains exact hashes', async () => {
  assert.deepEqual(decodeArtifact('YQ=='), new Uint8Array([97]));
  assert.throws(() => decodeArtifact(''), /编码无效/);
  const experiment = fixture();
  const artifact = await add(experiment, 'code');
  assert.equal(artifact.size, 4);
  assert.equal(artifact.sha256.length, 64);
  await assert.rejects(
    addExperimentArtifact(
      experiment,
      'old',
      {
        kind: 'result',
        filename: 'old.txt',
        note: 'Old version.',
        bytes: new Uint8Array([1]),
      },
      'tester',
    ),
    /版本已变化/,
  );
});

void test('independent reproduction requires code, environment and run evidence', async () => {
  const experiment = fixture();
  const code = await add(experiment, 'code');
  const environment = await add(experiment, 'environment');
  assert.throws(
    () =>
      recordIndependentReproduction(
        experiment,
        'v1',
        {
          artifactIds: [code.id, environment.id, code.id],
          executor: 'Independent synthetic runner',
          independenceBasis: 'Separate synthetic operator and workspace.',
          result: 'inconclusive',
          findings: 'No result artifact yet.',
          confirmed: true,
          reason: 'Incomplete evidence check.',
        },
        'tester',
      ),
    /重复引用/,
  );
  const result = await add(experiment, 'result');
  const record = recordIndependentReproduction(
    experiment,
    'v1',
    {
      artifactIds: [code.id, environment.id, result.id],
      executor: 'Independent synthetic runner',
      independenceBasis: 'Separate synthetic operator and workspace.',
      result: 'reproduced',
      findings: 'Synthetic output matched the expected fixture.',
      confirmed: true,
      reason: 'Checked all synthetic evidence.',
    },
    'tester',
  );
  assert.equal(record.verification, 'user_attested_hash_checked_attachments');
  const snapshot = await captureExperiment(experiment, 'v1', [0]);
  assert.deepEqual(snapshot.artifacts, experiment.artifacts);
  assert.deepEqual(snapshot.reproductions, experiment.reproductions);
});
