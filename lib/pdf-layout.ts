import type { Block, Paper } from './domain';

export type TextBox = {
  text: string;
  x: number;
  y: number;
  right: number;
  bottom: number;
};
export type PageHint = {
  page: number;
  layout: 'single' | 'two-column';
  rotated: boolean;
};
export type PageQuality = PageHint & {
  characters: number;
  blocks: number;
  issues: (
    | 'no-text'
    | 'sparse-text'
    | 'replacement-characters'
    | 'rotated-text'
    | 'ocr-text'
  )[];
};
export type ParseQuality = {
  engine: string;
  hash: string;
  pages: PageQuality[];
};

// Geometry is a reading-order heuristic, never a claim of faithful table/formula recovery.
export function layoutPage(
  items: TextBox[],
  page: number,
  width: number,
  height: number,
) {
  const lines: TextBox[] = [];
  const sorted = items
    .filter((i) => i.text.trim())
    .sort((a, b) => a.y - b.y || a.x - b.x);
  for (const item of sorted) {
    const font = Math.max(1, item.bottom - item.y);
    const line = lines.findLast(
      (l) =>
        Math.abs(l.bottom - item.bottom) < Math.min(3, font * 0.3) &&
        item.x >= l.right - 2 &&
        item.x - l.right <= Math.max(12, font * 1.3),
    );
    if (line) {
      line.text += (item.x - line.right > font * 0.15 ? ' ' : '') + item.text;
      line.right = Math.max(line.right, item.right);
      line.y = Math.min(line.y, item.y);
      line.bottom = Math.max(line.bottom, item.bottom);
    } else lines.push({ ...item });
  }
  const order = (a: TextBox, b: TextBox) => a.y - b.y || a.x - b.x;
  lines.sort(order);
  const gap = Math.max(10, width * 0.015);
  const isLeft = (l: TextBox, x: number) => l.right <= x - gap / 2;
  const isRight = (l: TextBox, x: number) => l.x >= x + gap / 2;
  /**
   * 整宽行（跨过分割线）会把页面切成若干竖直 band：标题、正文、图注、表头等。
   * 旧实现要求「全页跨线行不超过 15%」，在标题页/图表页上必然超限，于是整页被
   * 当成单栏按行读取，两栏正文互相交错（实测 HaWoR 第 1 页就是这样失败的）。
   * 现在改为：只要**最大的那个 band** 左右两侧都成规模，就认定这是分栏页。
   */
  let cut: number | undefined,
    score = -Infinity;
  for (let ratio = 0.3; ratio <= 0.7; ratio += 0.002) {
    const x = width * ratio;
    const left = lines.filter((l) => isLeft(l, x));
    const right = lines.filter((l) => isRight(l, x));
    if (left.length < 3 || right.length < 3) continue;
    if (
      [left, right].some(
        (side) => side.reduce((n, l) => n + l.text.length, 0) < 100,
      )
    )
      continue;
    const overlap =
      Math.min(left.at(-1)!.bottom, right.at(-1)!.bottom) -
      Math.max(left[0].y, right[0].y);
    if (overlap < 30) continue;
    const spanning = lines.filter((l) => !isLeft(l, x) && !isRight(l, x));
    let best = { left: 0, right: 0 },
      start = -Infinity;
    for (const heading of [...spanning, undefined]) {
      const end = heading?.y ?? Infinity;
      const band = lines.filter(
        (l) => !spanning.includes(l) && l.y >= start && l.y < end,
      );
      const l = band.filter((l) => isLeft(l, x)).length,
        r = band.filter((l) => isRight(l, x)).length;
      if (l + r > best.left + best.right) best = { left: l, right: r };
      start = end;
    }
    if (best.left < 3 || best.right < 3) continue;
    const value =
      Math.min(left.length, right.length) -
      spanning.length * 0.5 -
      Math.abs(ratio - 0.5);
    if (value > score) {
      score = value;
      cut = x;
    }
  }
  // Full-width headings delimit bands: heading, left column, right column, next heading.
  const sections: TextBox[][] = [];
  if (cut === undefined) sections.push(lines);
  else {
    const x = cut;
    const spanning = lines.filter(
      (l) => l.right > x - gap / 2 && l.x < x + gap / 2,
    );
    let start = -Infinity;
    for (const heading of [...spanning, undefined]) {
      const end = heading?.y ?? Infinity;
      const band = lines.filter(
        (l) => !spanning.includes(l) && l.y >= start && l.y < end,
      );
      sections.push(
        band.filter((l) => l.right <= x - gap / 2),
        band.filter((l) => l.x >= x + gap / 2),
      );
      if (heading) sections.push([heading]);
      start = end;
    }
  }
  const blocks: Block[] = [];
  for (const section of sections) {
    let group: TextBox[] = [],
      length = 0;
    const flush = () => {
      if (!group.length) return;
      blocks.push({
        id: `p${page}b${blocks.length}`,
        page,
        text: group.map((l) => l.text).join('\n'),
        rect: [
          Math.min(...group.map((l) => l.x)),
          Math.min(...group.map((l) => l.y)),
          Math.max(...group.map((l) => l.right)),
          Math.max(...group.map((l) => l.bottom)),
        ],
        width,
        height,
      });
      group = [];
      length = 0;
    };
    for (const line of section) {
      // Oversized text items retain every character and the source rectangle.
      for (let offset = 0; offset < line.text.length; offset += 5000) {
        const part = { ...line, text: line.text.slice(offset, offset + 5000) };
        const previous = group.at(-1);
        if (
          group.length >= 10 ||
          length + part.text.length + group.length > 5000 ||
          (previous &&
            part.y - previous.bottom > Math.max(8, part.bottom - part.y))
        )
          flush();
        group.push(part);
        length += part.text.length;
      }
    }
    flush();
  }
  return {
    blocks,
    layout: cut === undefined ? ('single' as const) : ('two-column' as const),
  };
}

// Recomputed from stored text on the server; client hints only describe the parser's layout decision.
export function pageQuality(
  blocks: Block[],
  pageCount: number,
  hints: PageHint[] = [],
): PageQuality[] {
  return Array.from({ length: pageCount }, (_, index) => {
    const page = index + 1,
      material = blocks.filter((b) => b.page === page);
    const text = material.map((b) => b.text).join(''),
      characters = text.replace(/\s/g, '').length;
    const hint = hints.find((h) => h.page === page);
    const issues: PageQuality['issues'] = [];
    if (!characters) issues.push('no-text');
    else if (characters < 80) issues.push('sparse-text');
    if (text.includes('\uFFFD')) issues.push('replacement-characters');
    if (hint?.rotated) issues.push('rotated-text');
    if (material.some((b) => b.ocr)) issues.push('ocr-text');
    return {
      page,
      characters,
      blocks: material.length,
      layout: hint?.layout ?? 'single',
      rotated: hint?.rotated ?? false,
      issues,
    };
  });
}

export const qualityIssueLabels: Record<PageQuality['issues'][number], string> =
  {
    'no-text': '未提取到文字，可能是扫描页、图像页或空白页',
    'sparse-text': '文字较少，请核对是否有遗漏',
    'replacement-characters': '包含乱码替代符，请核对原文',
    'rotated-text': '含旋转文字，阅读顺序需要核对',
    'ocr-text': '含模型OCR转录，文字与近似位置需对照原始页面',
  };

export function parsingContext(paper: Paper, blocks: Block[]) {
  const pages = pageQuality(blocks, paper.pages, paper.parsing?.pages);
  return {
    textLayerOnly: paper.kind === 'pdf' && !blocks.some((b) => b.ocr),
    hasOcr: blocks.some((b) => b.ocr),
    hasManualVersions: !!paper.parseVersionId,
    parseVersionId: paper.parseVersionId ?? 'original',
    engine: paper.parsing?.engine ?? 'legacy-client',
    missingPages: pages.filter((p) => !p.characters).map((p) => p.page),
    qualityWarnings:
      paper.kind === 'pdf'
        ? pages.flatMap((p) =>
            p.issues.map(
              (issue) => `第 ${p.page} 页：${qualityIssueLabels[issue]}`,
            ),
          )
        : [],
  };
}
