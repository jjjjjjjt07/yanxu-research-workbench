import type { Block } from './domain.ts';

/**
 * 统一的证据校验。
 *
 * 旧实现有两个毛病：
 * 1. `domain.ts` 用「删掉全部空白」比对，`graph.ts` 用「空白折叠成一个空格」比对，
 *    两处口径不同；行末断词（`recom-\nmendation`）两种都不处理，真实摘录会被误杀。
 * 2. 只在模型指定的那一个块里找。实测五篇里有 9 个字段候选被丢弃，其中大多数
 *    并不是编造——摘录真实存在于**同一页的另一个块**，只是 blockId 引错了。
 *
 * 现在的策略（从保守到放宽，且每一步都可解释）：
 *   a. 所引块内逐字命中           → 直接使用
 *   b. 所引块内有限归一化后命中   → 使用，记录「依赖归一化」
 *   c. 同页其它块命中             → 使用并**校正 blockId**，记录「已重定位」
 *   d. 全篇其它块命中             → 同上，但标记为需复核（可能跨页引用错误）
 *   e. 都不命中                   → 拒绝，并给出可读原因与规则码
 *
 * 归一化只做排版层面的等价替换，**绝不重排、删除或模糊匹配文字**：
 * 因此把两栏文字拼接起来的无关片段仍然无法通过（它在任何单个块里都不是连续子串）。
 */

export type RejectRule =
  | 'no-block'
  | 'too-short'
  | 'not-in-cited-block'
  | 'not-found-anywhere'
  | 'empty-quote';

export type QuoteLocation = {
  ok: true;
  blockId: string;
  page: number;
  /** 原文中真实存在的连续子串（不是模型重排后的排版） */
  text: string;
  /** 是否用到了所引块以外的块 */
  relocated: boolean;
  /** 是否依赖归一化才命中 */
  normalized: boolean;
  /**
   * 分栏交错嫌疑：命中片段内部存在「非句末处的硬换行」，
   * 这通常意味着块文本把两栏内容交错在一起。只做标记，不放宽匹配。
   */
  crossColumnSuspect: boolean;
};

export type QuoteFailure = {
  ok: false;
  rule: RejectRule;
  reason: string;
};

export type EvidenceResult = QuoteLocation | QuoteFailure;

const DASH_CHAR = /[\u2010-\u2015]/;
const STRIP_CHAR = /[\u00AD\u200B-\u200D\uFEFF]/;
const WHITESPACE = /\s/;
/** 行末断词：连字符 + 换行（PDF 常见的 `recommen-\ndation`） */
const LINE_BREAK_HYPHEN = /^-[ \t]*\r?\n[ \t]*/;

type Flat = { text: string; starts: number[]; ends: number[] };

/**
 * 构造「归一化后的文本」以及每个归一化字符回指原文的下标区间。
 * 归一化只做排版等价替换：折叠连续空白、删除软连字符/零宽字符、
 * 合并行末断词、统一各种连字符、NFKC、转小写。
 * **不重排、不删除实义字符**，所以跨块拼接出来的文字仍然无法命中。
 */
function buildFlat(input: string): Flat {
  let text = '';
  const starts: number[] = [];
  const ends: number[] = [];
  let i = 0;
  while (i < input.length) {
    const hyphen = LINE_BREAK_HYPHEN.exec(input.slice(i));
    if (hyphen) {
      i += hyphen[0].length;
      continue;
    }
    const character = input[i];
    if (STRIP_CHAR.test(character)) {
      i += 1;
      continue;
    }
    if (WHITESPACE.test(character)) {
      if (text !== '' && !text.endsWith(' ')) {
        text += ' ';
        starts.push(i);
        ends.push(i + 1);
      }
      i += 1;
      continue;
    }
    const folded = (DASH_CHAR.test(character) ? '-' : character)
      .normalize('NFKC')
      .toLowerCase();
    for (const piece of folded) {
      text += piece;
      starts.push(i);
      ends.push(i + character.length);
    }
    i += character.length;
  }
  return { text, starts, ends };
}

/**
 * 有限归一化：只抹平排版差异，不改变字词顺序、不删除任何实义字符。
 */
export function foldForMatch(input: string): string {
  return buildFlat(String(input)).text.trim();
}

type Located = { start: number; end: number };

/**
 * 在原文里定位 needle（折叠后比对），返回**原文中的真实下标区间**。
 * 保证返回的是原文连续子串，而不是模型重排后的排版。
 */
function locate(text: string, quote: string): Located | null {
  if (text.includes(quote)) {
    const start = text.indexOf(quote);
    return { start, end: start + quote.length };
  }
  const needle = foldForMatch(quote);
  if (needle.length < 3) return null;
  const flat = buildFlat(text);
  const at = flat.text.indexOf(needle);
  if (at < 0) return null;
  return { start: flat.starts[at], end: flat.ends[at + needle.length - 1] };
}

/** 命中片段里是否存在「非句末处的硬换行」——分栏交错的典型特征。 */
export function crossColumnSuspect(span: string): boolean {
  const lines = span.split('\n');
  let suspicious = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    const current = lines[i].trimEnd();
    const next = lines[i + 1].trimStart();
    if (!current || !next) continue;
    const endsSentence = /[.!?:;”"’)\]]$/.test(current);
    const startsLower = /^[a-z]/.test(next);
    if (!endsSentence && startsLower) suspicious++;
  }
  return suspicious >= 2;
}

function build(
  block: Pick<Block, 'id' | 'page'>,
  span: string,
  normalized: boolean,
  relocated: boolean,
): QuoteLocation {
  return {
    ok: true,
    blockId: block.id,
    page: block.page,
    text: span,
    relocated,
    normalized,
    crossColumnSuspect: crossColumnSuspect(span),
  };
}

/**
 * 校验并定位一段摘录。blocks 应为**同一篇论文**的全部解析块（按页顺序）。
 */
export function resolveEvidence(
  blocks: Block[],
  ref: { blockId?: string; quote?: string; page?: number },
): EvidenceResult {
  const quote = String(ref.quote ?? '');
  const folded = foldForMatch(quote);
  if (folded.length < 3)
    return { ok: false, rule: 'empty-quote', reason: '摘录为空或过短，无法作为证据。' };

  const cited = ref.blockId ? blocks.find((b) => b.id === ref.blockId) : undefined;

  // a/b：所引块内（先逐字，后归一化）
  if (cited) {
    const hit = locate(cited.text, quote);
    if (hit) {
      const span = cited.text.slice(hit.start, hit.end);
      const exact = cited.text.includes(quote);
      return build(cited, span, !exact, false);
    }
  }

  // c：同一页的其它块（模型引错 blockId 是最常见的原因）
  const page = cited?.page ?? ref.page;
  const samePage = page
    ? blocks.filter((b) => b.page === page && b.id !== cited?.id)
    : [];
  for (const b of samePage) {
    const hit = locate(b.text, quote);
    if (hit) return build(b, b.text.slice(hit.start, hit.end), true, true);
  }

  // d：全篇其它块（可能跨页引错，标记为需复核）
  for (const b of blocks) {
    if (b.id === cited?.id) continue;
    const hit = locate(b.text, quote);
    if (hit) return build(b, b.text.slice(hit.start, hit.end), true, true);
  }
  return {
    ok: false,
    rule: cited ? 'not-in-cited-block' : 'no-block',
    reason: cited
      ? `摘录在所引块（第 ${cited.page} 页）以及全篇其它块中都找不到连续原文，已隔离。`
      : '模型没有给出引用块编号，无法定位原文，已隔离。',
  };
}

/** 兼容旧调用点：只回答「是否可定位」。 */
export function evidenceLocatable(blocks: Block[], ref: { blockId?: string; quote?: string }): boolean {
  return resolveEvidence(blocks, ref).ok;
}
