import assert from 'node:assert/strict';
import test from 'node:test';
import { runBatch } from '../lib/batch.ts';
import {
  researchContext,
  selectReadingBlocks,
} from '../lib/research-context.ts';
import { emptyState, type Project } from '../lib/domain.ts';

void test('a failed first document never prevents later documents running', async () => {
  const visited: string[] = [];
  const result = await runBatch(['bad', 'second', 'third'], async (id) => {
    visited.push(id);
    if (id === 'bad') throw new Error('model timeout');
  });
  assert.deepEqual(visited, ['bad', 'second', 'third']);
  assert.equal(result.succeeded, 2);
  assert.deepEqual(result.failures, [
    { item: 'bad', message: 'model timeout' },
  ]);
});
void test('legacy projects include their title even when research question is empty', () => {
  const p = {
    title: '低算力图像识别',
    question: '',
    state: emptyState(),
  } as Project;
  delete p.state.profile;
  delete p.state.readingFeedback;
  const context = researchContext(p);
  assert.equal(context.title, p.title);
  assert.equal(context.equipment, '未填写');
  assert.deepEqual(context.readingFeedback, []);
});
void test('project context carries equipment, prior observations and notes from other papers', () => {
  const p = { title: '课题', question: '目标', state: emptyState() } as Project;
  p.state.profile = {
    equipment: 'CPU',
    currentMethod: 'SampleNet',
    constraints: '8GB',
  };
  p.state.readingFeedback = [
    {
      id: 'r',
      paperIds: ['p2'],
      text: 'Method B',
      status: 'unsuitable',
      reason: 'requires GPU',
      at: '',
    },
  ];
  p.state.notes.push({
    id: 'n',
    paperId: 'p1',
    blockId: '',
    text: 'A is too slow',
    at: '',
  });
  const c = researchContext(p);
  assert.equal(c.equipment, 'CPU');
  assert.equal(c.readingFeedback[0].reason, 'requires GPU');
  assert.equal(c.notes[0].text, 'A is too slow');
});
void test('long-paper retrieval respects the per-paper budget and retrieves late relevant evidence', () => {
  const blocks = Array.from({ length: 20 }, (_, i) => ({
    id: String(i),
    page: i + 1,
    text: 'background '.repeat(50),
  }));
  blocks[19].text = 'target accuracy 92 percent';
  const chosen = selectReadingBlocks(blocks, 'target accuracy', 1200);
  assert.ok(chosen.some((b) => b.id === '19'));
  assert.ok(chosen.reduce((n, b) => n + b.text.length, 0) <= 1200);
  assert.deepEqual(selectReadingBlocks(blocks, 'target', 20000), blocks);
});
