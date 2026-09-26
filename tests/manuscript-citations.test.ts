import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeCitationBinding,
  saveCitation,
  withdrawCitation,
  citationStatus,
} from '../lib/manuscript-citations.ts';
import { saveManuscript } from '../lib/manuscript.ts';
import { invalidatePaperSources } from '../lib/parse-versions.ts';
import type { Review, Paper, ProjectState } from '../lib/domain';
import type { SourceReference } from '../lib/source-reference';
const source: SourceReference = {
  paperId: 'p',
  documentHash: 'doc',
  parseHash: 'parse',
  parseVersionId: 'original',
  blockId: 'b',
  page: 1,
  quote: 'Dataset A',
};
const paper = { id: 'p', hash: 'doc', parsing: { hash: 'parse' } } as Paper;
const review = (): Review => ({
  oldText: '',
  newText: 'The method uses Dataset A.',
  feedback: '',
  items: [],
  analyzedHash: '',
  history: [],
});
await test('saving unchanged legacy draft does not create a new binding version', async () => {
  const r = review();
  saveCitation(
    r,
    await makeCitationBinding(
      r,
      'Dataset A',
      source,
      'author',
      'checked legacy text',
    ),
  );
  const before = structuredClone(r);
  assert.equal(
    saveManuscript(
      r,
      { oldText: r.oldText, newText: r.newText, feedback: r.feedback },
      'author',
    ),
    false,
  );
  assert.deepEqual(r, before);
  assert.equal(citationStatus(r.citations![0], r, [paper]), 'linked');
});
await test('manuscript citation anchors an exact unique phrase and refuses invented/ambiguous claims', async () => {
  const r = review();
  const binding = await makeCitationBinding(
    r,
    'Dataset A',
    source,
    'author',
    'Compared original',
  );
  assert.equal(r.newText.slice(binding.start, binding.end), 'Dataset A');
  assert.equal(binding.manuscriptHash.length, 64);
  await assert.rejects(
    makeCitationBinding(r, 'Dataset B', source, 'author', 'reason'),
  );
  await assert.rejects(
    makeCitationBinding(
      { ...r, newText: 'A and A' },
      'A',
      source,
      'author',
      'reason',
    ),
  );
  await assert.rejects(
    makeCitationBinding(r, 'Dataset A', source, 'author', ' '),
  );
});
await test('parse and manuscript restores retain snapshots, withdraw cannot silently regain active status', async () => {
  const r = review();
  saveManuscript(
    r,
    { oldText: '', newText: r.newText, feedback: 'check' },
    'author',
  );
  const originalVersion = r.versions!.at(-1)!;
  saveCitation(
    r,
    await makeCitationBinding(r, 'Dataset A', source, 'author', 'initial'),
  );
  const c = r.citations![0],
    original = structuredClone(c.source);
  assert.equal(citationStatus(c, r, [paper]), 'linked');
  invalidatePaperSources(
    { cells: [], notes: [], review: r } as unknown as ProjectState,
    'p',
  );
  assert.equal(c.status, 'stale');
  assert.deepEqual(c.source, original);
  saveCitation(
    r,
    await makeCitationBinding(r, 'Dataset A', source, 'author', 'recheck'),
    c.id,
  );
  assert.equal(c.history[0].status, 'stale');
  saveManuscript(
    r,
    { oldText: '', newText: 'Now using Dataset B.', feedback: 'check' },
    'author',
  );
  assert.equal(citationStatus(c, r, [paper]), 'stale');
  saveManuscript(r, originalVersion, 'author', originalVersion.id);
  assert.equal(c.status, 'stale');
  saveCitation(
    r,
    await makeCitationBinding(
      r,
      'Dataset A',
      source,
      'author',
      'restored and rechecked',
    ),
    c.id,
  );
  withdrawCitation(r, c.id, 'author', 'not suitable');
  assert.equal(c.status, 'withdrawn');
  assert.deepEqual(c.history.at(-1)!.binding.source, original);
  saveManuscript(r, originalVersion, 'author', originalVersion.id);
  assert.equal(c.status, 'withdrawn');
  saveCitation(
    r,
    await makeCitationBinding(
      r,
      'Dataset A',
      source,
      'author',
      'explicitly restore citation',
    ),
    c.id,
  );
  assert.equal(c.history.at(-1)!.status, 'withdrawn');
  assert.equal(c.status, 'linked');
});
