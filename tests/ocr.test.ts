import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ocrBlocks,
  ocrSchema,
  pngSize,
  replaceOcrPage,
  type OcrPreview,
} from '../lib/ocr.ts';
import { pageQuality } from '../lib/pdf-layout.ts';
import { LIMITS } from '../lib/limits.ts';

const result = {
  blocks: [
    {
      text: 'Visible text',
      rect: [100, 200, 800, 300] as [number, number, number, number],
    },
  ],
  warnings: [],
};
const blocks = ocrBlocks(result, 2, 600, 800, 'fixture');
const preview: OcrPreview = {
  id: 'fixture',
  paperId: 'p',
  documentHash: 'd',
  parseHash: 'h',
  revision: 1,
  page: 2,
  model: 'deepseek-flash',
  at: 'now',
  imageHash: 'i',
  blocks,
  warnings: [],
};
await test('OCR scales page coordinates and keeps quality warning after acceptance', () => {
  assert.deepEqual(blocks[0].rect, [60, 160, 480, 240]);
  assert.equal(blocks[0].ocr?.model, 'deepseek-flash');
  assert.ok(pageQuality(blocks, 2)[1].issues.includes('ocr-text'));
});
await test('OCR page replacement preserves other pages and refuses empty/oversized results', () => {
  const before = { id: 'before', page: 1, text: 'Keep first page' };
  const after = { id: 'after', page: 3, text: 'Keep last page' };
  const current = [before, { id: 'old', page: 2, text: 'Old text' }, after];
  assert.deepEqual(replaceOcrPage(current, preview), [
    before,
    ...blocks,
    after,
  ]);
  assert.equal(current[1].text, 'Old text');
  assert.throws(() => replaceOcrPage(current, { ...preview, blocks: [] }));
  assert.throws(() =>
    replaceOcrPage(
      [{ ...before, text: 'x'.repeat(LIMITS.maxTotalChars + 1) }],
      preview,
    ),
  );
});
await test('OCR rejects model rectangles outside page or inverted positions', () => {
  assert.equal(
    ocrSchema.safeParse({
      ...result,
      blocks: [{ text: 'bad', rect: [-1, 0, 20, 20] }],
    }).success,
    false,
  );
  assert.throws(() =>
    ocrBlocks(
      { ...result, blocks: [{ text: 'bad', rect: [500, 0, 100, 20] }] },
      1,
      600,
      800,
      'bad',
    ),
  );
});
await test('PNG validation rejects wrong formats and excessive dimensions', () => {
  const png = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.write('IHDR', 12);
  png.writeUInt32BE(600, 16);
  png.writeUInt32BE(800, 20);
  const image = () => 'data:image/png;base64,' + png.toString('base64');
  assert.deepEqual(pngSize(image()), { width: 600, height: 800 });
  png.writeUInt32BE(9999, 16);
  assert.throws(() => pngSize(image()));
  assert.throws(() => pngSize('data:image/jpeg;base64,AAAA'));
  assert.throws(() => pngSize('data:image/png;base64,AAAA'));
});
