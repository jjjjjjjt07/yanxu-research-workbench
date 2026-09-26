import type { Block } from './domain';
import { FILE_MB, LIMITS } from './limits';
import { layoutPage, type PageHint, type TextBox } from './pdf-layout';

/**
 * 纯文本分页：优先使用显式页标记，其次使用换页符，最后退化为单页。
 * 解决旧版把 TXT 全部内容记为「第 1 页」、导致页码回跳失效的问题。
 * 支持：`===== [p.7] =====`、`[[page:7]]`、以及换页符 \f
 */
const PAGE_MARKER =
  /^\s*={2,}\s*\[\s*p\.?\s*(\d+)\s*\]\s*={2,}\s*$|^\s*\[\[\s*page\s*[:=]?\s*(\d+)\s*\]\]\s*$/i;
export function splitTextPages(text: string) {
  const pages: { page: number; lines: string[] }[] = [];
  let current: { page: number; lines: string[] } | null = null;
  let byMarkers = false;
  for (const chunk of text.split('\f')) {
    for (const line of chunk.split(/\r\n|\r|\n/)) {
      const hit = PAGE_MARKER.exec(line);
      if (hit) {
        byMarkers = true;
        const n = Number(hit[1] ?? hit[2]);
        current = {
          page: Number.isInteger(n) && n > 0 ? n : pages.length + 2,
          lines: [],
        };
        pages.push(current);
        continue;
      }
      if (!current) {
        current = { page: 1, lines: [] };
        pages.push(current);
      }
      current.lines.push(line);
    }
  }
  return { pages, byMarkers };
}
export async function pdfLibrary() {
  const pdf = await import('pdfjs-dist');
  pdf.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();
  return pdf;
}
export const pdfAssets = {
  cMapUrl: '/pdf-assets/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/pdf-assets/standard_fonts/',
  wasmUrl: '/pdf-assets/wasm/',
};
export async function parseDocument(
  file: File,
  onProgress: (page: number, total: number) => void,
) {
  if (file.size > LIMITS.fileBytes)
    throw new Error(`请选择 ${FILE_MB} MB 以下的文件。`);
  if (file.name.toLowerCase().endsWith('.txt')) {
    const text = await file.text();
    if (text.length > LIMITS.maxTotalChars)
      throw new Error(
        `文档超过 ${LIMITS.maxTotalChars.toLocaleString('en-US')} 字符的处理上限。`,
      );
    const { pages: textPages } = splitTextPages(text);
    const blocks: Block[] = [];
    const hints: PageHint[] = [];
    for (const p of textPages) {
      for (const piece of p.lines
        .join('\n')
        .split(/\n\s*\n/)
        .flatMap((s) => s.match(/[\s\S]{1,5000}/g) ?? [])
        .filter((s) => s.trim() && s !== '\n'))
        blocks.push({ id: `b${blocks.length}`, page: p.page, text: piece });
      hints.push({ page: p.page, layout: 'single', rotated: false });
    }
    const pageCount = Math.max(1, ...hints.map((h) => h.page));
    onProgress(pageCount, pageCount);
    return {
      blocks,
      pageCount,
      parsing: { engine: 'plain-text-v1' as const, pages: hints },
    };
  }
  if (!file.name.toLowerCase().endsWith('.pdf'))
    throw new Error('请上传 PDF 或 TXT 文件。');
  const pdf = await pdfLibrary(),
    task = pdf.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      useSystemFonts: true,
      ...pdfAssets,
    });
  const blocks: Block[] = [],
    pages: PageHint[] = [];
  let chars = 0,
    pageCount = 0;
  try {
    const doc = await task.promise;
    pageCount = doc.numPages;
    if (pageCount > LIMITS.maxPages)
      throw new Error(
        `当前支持 ${LIMITS.maxPages} 页以内的 PDF，请拆分文档。`,
      );
    for (let n = 1; n <= pageCount; n++) {
      onProgress(n, pageCount);
      const page = await doc.getPage(n);
      try {
        const view = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const items: TextBox[] = [];
        let rotated = false;
        for (const item of content.items) {
          if (!('str' in item) || !item.str.trim()) continue;
          const t = pdf.Util.transform(view.transform, item.transform);
          const h = Math.max(1, Math.hypot(t[2], t[3])),
            baseline = Math.max(0.001, Math.hypot(t[0], t[1]));
          const ux = t[0] / baseline,
            uy = t[1] / baseline;
          if (Math.abs(uy) > 0.1 || ux < 0 || item.dir === 'ttb')
            rotated = true;
          const vx = t[2] / h,
            vy = t[3] / h;
          const xs = [
            t[4],
            t[4] + ux * item.width,
            t[4] + vx * h,
            t[4] + ux * item.width + vx * h,
          ];
          const ys = [
            t[5],
            t[5] + uy * item.width,
            t[5] + vy * h,
            t[5] + uy * item.width + vy * h,
          ];
          items.push({
            text: item.str,
            x: Math.min(...xs),
            y: Math.min(...ys),
            right: Math.max(...xs),
            bottom: Math.max(...ys),
          });
        }
        const result = layoutPage(items, n, view.width, view.height);
        blocks.push(...result.blocks);
        pages.push({ page: n, layout: result.layout, rotated });
        chars += result.blocks.reduce((sum, b) => sum + b.text.length, 0);
        // 只保留防滥用兜底，不再按 8 万字符中止整篇导入。
        if (chars > LIMITS.maxTotalChars)
          throw new Error(
            `解析文本超过 ${LIMITS.maxTotalChars.toLocaleString('en-US')} 字符，请拆分文档。`,
          );
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await task.destroy();
  }
  return { blocks, pageCount, parsing: { engine: 'pdfjs-layout-v3', pages } };
}

export async function parseFile(
  file: File,
  onProgress: (page: number, total: number) => void,
): Promise<Block[]> {
  return (await parseDocument(file, onProgress)).blocks;
}

export async function renderOcrPage(url: string, pageNumber: number) {
  const pdf = await pdfLibrary(),
    task = pdf.getDocument({ url, ...pdfAssets });
  try {
    const doc = await task.promise,
      page = await doc.getPage(pageNumber),
      natural = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({
      scale: Math.min(2, LIMITS.ocrImageEdge / Math.max(natural.width, natural.height)),
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    const image = canvas.toDataURL('image/png');
    canvas.width = 0;
    canvas.height = 0;
    if (image.length > LIMITS.ocrImageBytes)
      throw new Error('这一页图片过大，请先压缩PDF或拆分后上传。');
    return image;
  } finally {
    await task.destroy();
  }
}
