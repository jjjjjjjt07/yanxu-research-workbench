import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureSource,
  rebindNote,
  noteSourceStatus,
  type ReadingNote,
} from '../lib/source-reference.ts';
import { invalidatePaperSources } from '../lib/parse-versions.ts';
import { researchContext } from '../lib/research-context.ts';
import type { Paper, Project, ProjectState } from '../lib/domain';
const paper = { id: 'p', hash: 'document', pages: 1 } as Paper;
const blocks = [
  { id: 'b', page: 1, text: 'Method uses Dataset A.', rect: [1, 2, 3, 4] },
];
const note = (): ReadingNote => ({
  id: 'n',
  paperId: 'p',
  blockId: 'b',
  text: 'My observation',
  at: 'original-time',
});

await test('source capture derives page, version and exact quote; refuses invented or mismatched sources', async () => {
  const source = await captureSource(paper, blocks, 'b', 'Dataset A');
  assert.equal(source.page, 1);
  assert.equal(source.parseVersionId, 'original');
  assert.equal(source.documentHash, paper.hash);
  assert.equal(source.parseHash.length, 64);
  assert.deepEqual(source.rect, blocks[0].rect);
  assert.notEqual(source.rect, blocks[0].rect);
  await assert.rejects(captureSource(paper, blocks, 'missing'));
  await assert.rejects(captureSource(paper, blocks, 'b', 'dataset B'));
  await assert.rejects(
    captureSource(
      { ...paper, parsing: { engine: 'manual', hash: 'wrong', pages: [] } },
      blocks,
      'b',
    ),
  );
});
await test('rebind preserves note and previous source, while parse changes never automatically re-confirm it', async () => {
  const n = note(),
    source = await captureSource(paper, blocks, 'b');
  assert.equal(noteSourceStatus(n, [paper]), 'legacy');
  rebindNote(n, source, 'reviewer', 't1', 'Compared original');
  assert.equal(n.text, 'My observation');
  assert.equal(n.at, 'original-time');
  assert.equal(n.sourceHistory?.[0].source, undefined);
  assert.equal(noteSourceStatus(n, [paper]), 'reviewed');
  invalidatePaperSources(
    { cells: [], notes: [n] } as unknown as ProjectState,
    'p',
  );
  assert.equal(noteSourceStatus(n, [paper]), 'stale');
  rebindNote(n, source, 'reviewer', 't2', 'Compared restored original');
  assert.equal(n.sourceHistory?.[1].sourceNeedsReview, true);
  assert.equal(n.sourceHistory?.[1].source?.review?.at, 't1');
  assert.equal(n.source?.review?.at, 't2');
  assert.equal(
    noteSourceStatus(n, [{ ...paper, hash: 'replacement' }]),
    'stale',
  );
  assert.equal(
    noteSourceStatus(n, [
      { ...paper, parsing: { hash: 'new', engine: 'manual', pages: [] } },
    ]),
    'stale',
  );
  assert.throws(() => rebindNote(n, source, 'reviewer', 't3', ' '));
  assert.throws(() =>
    rebindNote(
      n,
      { ...source, paperId: 'other' },
      'reviewer',
      't3',
      'wrong paper',
    ),
  );
});
await test('question context retains personal observation but omits stale citations and source history', async () => {
  const n = note();
  n.source = await captureSource(paper, blocks, 'b');
  n.sourceNeedsReview = true;
  const p = {
    title: 'test',
    question: 'test',
    state: { papers: [paper], notes: [n] },
  } as Project;
  const context = researchContext(p);
  assert.equal(context.notes[0].text, n.text);
  assert.equal(context.notes[0].sourceStatus, 'stale');
  assert.equal(context.notes[0].source, undefined);
  assert.equal('sourceHistory' in context.notes[0], false);
  n.sourceNeedsReview = false;
  assert.equal(researchContext(p).notes[0].sourceStatus, 'linked');
  assert.equal(noteSourceStatus({ ...n, blockId: '' }, [paper]), 'observation');
});
