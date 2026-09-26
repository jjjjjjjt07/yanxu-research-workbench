import test from 'node:test';
import assert from 'node:assert/strict';
import {
  answerStatus,
  answerPrefix,
  type AnswerRecord,
} from '../lib/answer-history.ts';
import type { Project } from '../lib/domain';
const record = {
  contextHash: 'context',
  inputs: [
    {
      paperId: 'p',
      documentHash: 'doc',
      parseHash: 'parse',
      parseVersionId: 'v1',
    },
  ],
} as AnswerRecord;
const project = {
  state: { papers: [{ id: 'p', hash: 'doc', parseVersionId: 'v1' }] },
} as Project;
await test('history flags missing/reparsed inputs and context changes without modifying original record', () => {
  const original = structuredClone(record);
  assert.deepEqual(answerStatus(record, project, 'context', { p: 'parse' }), {
    stalePaperIds: [],
    contextChanged: false,
    needsReview: false,
  });
  assert.equal(
    answerStatus(record, project, 'new-context', { p: 'parse' }).contextChanged,
    true,
  );
  assert.deepEqual(
    answerStatus(record, project, 'context', { p: 'new-parse' }).stalePaperIds,
    ['p'],
  );
  assert.equal(
    answerStatus(
      record,
      { state: { papers: [] } } as unknown as Project,
      'context',
      {},
    ).needsReview,
    true,
  );
  assert.deepEqual(record, original);
});
await test('restoring equal text creates a distinct input version and cannot freshen an old answer', () => {
  const restored = structuredClone(project);
  restored.state.papers[0].parseVersionId = 'v3';
  assert.equal(
    answerStatus(record, restored, 'context', { p: 'parse' }).needsReview,
    true,
  );
  assert.notEqual(answerPrefix('ownerA', 'p'), answerPrefix('ownerB', 'p'));
  assert.notEqual(answerPrefix('ownerA', 'p'), answerPrefix('ownerA', 'other'));
});
