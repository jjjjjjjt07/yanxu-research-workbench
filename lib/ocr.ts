import { z } from 'zod';
import type { Block } from './domain';
import { LIMITS } from './limits.ts';
export const ocrSchema = z.object({
  blocks: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(5000),
        rect: z.tuple([
          z.number().min(0).max(1000),
          z.number().min(0).max(1000),
          z.number().min(0).max(1000),
          z.number().min(0).max(1000),
        ]),
      }),
    )
    .max(60),
  warnings: z.array(z.string().max(600)).max(20),
});
export type OcrPreview = {
  id: string;
  paperId: string;
  documentHash: string;
  parseHash: string;
  revision: number;
  page: number;
  model: string;
  at: string;
  imageHash: string;
  blocks: Block[];
  warnings: string[];
};
export function ocrBlocks(
  result: z.infer<typeof ocrSchema>,
  page: number,
  width: number,
  height: number,
  id: string,
): Block[] {
  if (result.blocks.reduce((n, b) => n + b.text.length, 0) > LIMITS.ocrBlockChars)
    throw new Error(
      `单页识别文本超过${LIMITS.ocrBlockChars.toLocaleString('en-US')}字符。`,
    );
  return result.blocks.map((b, i) => {
    if (b.rect[0] >= b.rect[2] || b.rect[1] >= b.rect[3])
      throw new Error('识别位置框无效，请重新识别。');
    return {
      id: `ocr:${id}:${i}`,
      page,
      text: b.text,
      rect: b.rect.map((n, i) => (n / 1000) * (i % 2 ? height : width)),
      width,
      height,
      ocr: { model: 'deepseek-flash', previewId: id },
    };
  });
}
export function replaceOcrPage(current: Block[], preview: OcrPreview): Block[] {
  if (!preview.blocks.length) throw new Error('没有可保存的识别文字。');
  const next = [
    ...current.filter((b) => b.page < preview.page),
    ...preview.blocks,
    ...current.filter((b) => b.page > preview.page),
  ];
  if (
    next.length > LIMITS.maxBlocks ||
    next.reduce((n, b) => n + b.text.length, 0) > LIMITS.maxTotalChars
  )
    throw new Error('文献解析容量超限，原文本未替换。');
  return next;
}
export function pngSize(dataUrl: string) {
  if (
    dataUrl.length > LIMITS.ocrImageBytes ||
    !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(dataUrl)
  )
    throw new Error('请使用2MB以内的页面PNG。');
  const raw = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  if (
    raw.length < 33 ||
    raw.slice(0, 8) !== '\x89PNG\r\n\x1a\n' ||
    raw.slice(12, 16) !== 'IHDR'
  )
    throw new Error('页面图片无效。');
  const view = new DataView(
    Uint8Array.from(raw.slice(16, 24), (c) => c.charCodeAt(0)).buffer,
  );
  const width = view.getUint32(0),
    height = view.getUint32(4);
  if (
    width < 50 ||
    height < 50 ||
    width > LIMITS.ocrImageEdge ||
    height > LIMITS.ocrImageEdge
  )
    throw new Error(
      `页面图片边长须在50至${LIMITS.ocrImageEdge}像素内。`,
    );
  return { width, height };
}
