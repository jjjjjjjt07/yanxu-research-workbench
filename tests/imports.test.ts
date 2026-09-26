import test from 'node:test';
import assert from 'node:assert/strict';
import { splitBlocks, reasonCode, REASON_LABELS, mergeFieldCells } from '../lib/imports.ts';
import { batchByBudget, takeWithinBudget, modelInputBudget } from '../lib/limits.ts';
import type { Block } from '../lib/domain.ts';

const block = (id: string, page: number, len: number): Block => ({
  id,
  page,
  text: 'x'.repeat(len),
});

void test('splitBlocks keeps every block, in order, and stays within the target', () => {
  const blocks = [
    block('a', 1, 100),
    block('b', 2, 100),
    block('c', 3, 100),
    block('d', 4, 100),
  ];
  const segments = splitBlocks(blocks, 250);
  assert.equal(segments.length, 2);
  assert.deepEqual(
    segments.flat().map((b) => b.id),
    ['a', 'b', 'c', 'd'],
  );
  for (const segment of segments) {
    const chars = segment.reduce((n, b) => n + b.text.length, 0);
    assert.ok(chars <= 250, 'segment within target');
  }
  // 单个块本身超预算时也必须保留，不能被丢弃
  const oversized = splitBlocks([block('big', 1, 500)], 250);
  assert.equal(oversized.length, 1);
  assert.equal(oversized[0][0].id, 'big');
  assert.deepEqual(splitBlocks([], 250), [[]]);
});

void test('splitBlocks output reassembles into the original block list', () => {
  const blocks = Array.from({ length: 37 }, (_, i) =>
    block(`b${i}`, (i % 9) + 1, 7000 + i),
  );
  const segments = splitBlocks(blocks, 50_000);
  assert.ok(segments.length > 1, 'long document is segmented');
  assert.deepEqual(segments.flat(), blocks);
});

void test('batchByBudget assigns every item to exactly one batch', () => {
  const items = [10, 20, 30, 40, 50].map((n) => ({ n }));
  const batches = batchByBudget(items, (i) => i.n, 60);
  assert.equal(batches.flat().length, items.length);
  assert.deepEqual(
    batches.flat().map((i) => i.n),
    [10, 20, 30, 40, 50],
  );
  for (const batch of batches)
    assert.ok(batch.reduce((n, i) => n + i.n, 0) <= 60);
});

void test('takeWithinBudget reports partial coverage instead of silently truncating', () => {
  const items = [10, 20, 30].map((n) => ({ n }));
  const full = takeWithinBudget(items, (i) => i.n, 100);
  assert.equal(full.partial, false);
  assert.equal(full.selected.length, 3);
  const partial = takeWithinBudget(items, (i) => i.n, 35);
  assert.equal(partial.partial, true);
  assert.deepEqual(partial.selected.map((i) => i.n), [10, 20]);
  assert.equal(partial.omitted, 1);
});

void test('mergeFieldCells keeps one cell per field and surfaces conflicts in the note', () => {
  const base = {
    fieldId: 'f1',
    blockId: 'b1',
    quote: 'q',
    note: '',
  };
  const merged = mergeFieldCells([
    { ...base, value: '1200' },
    { ...base, fieldId: 'f2', value: '', blockId: '', quote: '', note: '未报告' },
    { ...base, value: '4800' },
    { ...base, fieldId: 'f2', value: '未知', blockId: 'b9', quote: 'q9' },
  ]);
  assert.equal(merged.length, 2);
  const f1 = merged.find((c) => c.fieldId === 'f1')!;
  assert.match(f1.note, /分段提取出现不同取值/);
  assert.match(f1.note, /1200/);
  assert.match(f1.note, /4800/);
  const f2 = merged.find((c) => c.fieldId === 'f2')!;
  assert.equal(f2.value, '未知', 'empty value yields to a value with evidence');
});

void test('reasonCode maps server messages onto stable codes with labels', () => {
  assert.equal(reasonCode('请选择 60 MB 以下的 PDF 或 TXT 文件。'), 'file-too-large');
  assert.equal(reasonCode('解析文本超过 4,000,000 字符，请拆分文档。'), 'text-too-large');
  assert.equal(reasonCode('这篇文献已经在当前课题中。'), 'duplicate');
  assert.equal(reasonCode('请求过大，请使用 60 MB 以下的文献。'), 'request-too-large');
  assert.equal(reasonCode('完全没见过的错误'), 'rejected');
  for (const value of Object.values(REASON_LABELS)) assert.ok(value.length > 0);
});

void test('model input budgets are bounded per task and generous enough for long papers', () => {
  for (const task of ['extract', 'graphExcerpts', 'bridge', 'reader'] as const) {
    const budget = modelInputBudget(task);
    assert.ok(budget > 0 && budget <= 1_000_000);
  }
  // 一篇 10 万字符的论文应当一次装得下，超出才分段
  assert.ok(modelInputBudget('graphExcerpts') >= 100_000);
});
