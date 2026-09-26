import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutPage, pageQuality, type TextBox } from '../lib/pdf-layout.ts';

const box = (text: string, x: number, y: number, right = x + 220): TextBox => ({
  text,
  x,
  y,
  right,
  bottom: y + 10,
});
const column = (prefix: string, x: number, y = 100) =>
  Array.from({ length: 4 }, (_, i) =>
    box(
      `${prefix}${i} Synthetic text for reading-order verification.`,
      x,
      y + i * 18,
    ),
  );

void test('two columns read left to right without merging equal-baseline text; preserve heading and footer', () => {
  const items = [
    box('Full width heading', 40, 30, 555),
    ...column('LEFT', 40),
    ...column('RIGHT', 330),
    box('Full width footer', 40, 300, 555),
  ];
  const result = layoutPage(items.reverse(), 1, 600, 800);
  assert.equal(result.layout, 'two-column');
  assert.deepEqual(
    result.blocks.map((b) => b.text),
    [
      'Full width heading',
      column('LEFT', 40)
        .map((b) => b.text)
        .join('\n'),
      column('RIGHT', 330)
        .map((b) => b.text)
        .join('\n'),
      'Full width footer',
    ],
  );
  assert.deepEqual(result.blocks[1].rect, [40, 100, 260, 164]);
  assert.deepEqual(result.blocks[2].rect, [330, 100, 550, 164]);
});

void test('full width middle heading separates successive pairs of columns', () => {
  const items = [
    ...column('A', 40),
    ...column('B', 330),
    box('Second section', 40, 200, 550),
    ...column('C', 40, 240),
    ...column('D', 330, 240),
  ];
  const result = layoutPage(items, 1, 600, 800);
  assert.deepEqual(
    result.blocks.map((b) => b.text[0]),
    ['A', 'B', 'S', 'C', 'D'],
  );
  for (const item of items)
    assert.equal(
      result.blocks.filter((b) => b.text.includes(item.text)).length,
      1,
    );
});

void test('normal text joins nearby fragments, paragraphs remain separate, sparse rows are not treated as columns', () => {
  const items = [
    box('Hello', 40, 40, 65),
    box('world', 69, 40, 99),
    box('Next paragraph', 40, 120, 400),
  ];
  const result = layoutPage(items, 2, 600, 800);
  assert.equal(result.layout, 'single');
  assert.deepEqual(
    result.blocks.map((b) => b.text),
    ['Hello world', 'Next paragraph'],
  );
  assert.ok(result.blocks.every((b) => b.page === 2));
  assert.equal(
    layoutPage([box('A', 40, 40), box('B', 330, 40)], 1, 600, 800).layout,
    'single',
  );
});

void test('oversized fragments retain all text in bounded blocks and IDs are unique', () => {
  const text = '甲'.repeat(12000);
  const result = layoutPage([box(text, 30, 30, 500)], 3, 600, 800);
  assert.equal(result.blocks.map((b) => b.text).join(''), text);
  assert.ok(result.blocks.every((b) => b.text.length <= 5000));
  assert.equal(
    new Set(result.blocks.map((b) => b.id)).size,
    result.blocks.length,
  );
});

void test('quality includes empty trailing pages and reports sparse text, replacement characters and rotation without claiming OCR', () => {
  const blocks = [
    { id: '1', page: 1, text: 'A'.repeat(100) },
    { id: '2', page: 2, text: ' \uFFFD \n' },
  ];
  const pages = pageQuality(blocks, 3, [
    { page: 1, layout: 'two-column', rotated: false },
    { page: 2, layout: 'single', rotated: true },
  ]);
  assert.deepEqual(
    pages.map((p) => p.characters),
    [100, 1, 0],
  );
  assert.deepEqual(pages[0].issues, []);
  assert.deepEqual(pages[1].issues, [
    'sparse-text',
    'replacement-characters',
    'rotated-text',
  ]);
  assert.deepEqual(pages[2].issues, ['no-text']);
  assert.equal(pages[2].blocks, 0);
});

void test('narrow PMLR gutter separates columns at an off-grid cut', () => {
  const items = [...column('LEFT',69.44).map(b=>({...b,right:289.44})), ...column('RIGHT',307.44)];
  const result = layoutPage(items,1,612,792);
  assert.equal(result.layout,'two-column');
  assert.ok(result.blocks[0].text.includes('LEFT3'));
  assert.ok(!result.blocks[0].text.includes('RIGHT'));
});
