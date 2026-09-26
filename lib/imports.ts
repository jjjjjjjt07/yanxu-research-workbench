import type { Block } from './domain.ts';
import { LIMITS } from './limits.ts';

/**
 * 按字符预算把解析块切成多段，用于分段存储。
 * 只切分、不丢弃：所有块都会被写入，段数记录在 Paper.blockSegments 上。
 */
export function splitBlocks(
  blocks: Block[],
  target: number = LIMITS.segmentChars,
): Block[][] {
  const segments: Block[][] = [];
  let current: Block[] = [];
  let used = 0;
  for (const block of blocks) {
    const size = block.text.length;
    if (current.length && used + size > target) {
      segments.push(current);
      current = [];
      used = 0;
    }
    current.push(block);
    used += size;
  }
  if (current.length) segments.push(current);
  return segments.length ? segments : [[]];
}

/** 把报错文案映射成可筛选的原因代码，便于在导入记录里归因。 */
export function reasonCode(message: string) {
  if (message.includes('请求过大')) return 'request-too-large';
  if (message.includes('MB 以下')) return 'file-too-large';
  if (message.includes('字符')) return 'text-too-large';
  if (message.includes('页')) return 'page-limit';
  if (message.includes('已经') && message.includes('课题')) return 'duplicate';
  if (message.includes('不是有效 PDF')) return 'invalid-pdf';
  if (message.includes('未提取到文字')) return 'no-text';
  if (message.includes('最多') && message.includes('篇')) return 'project-full';
  if (message.includes('解析') || message.includes('读取') || message.includes('pdf'))
    return 'parse-failed';
  return 'rejected';
}

/** 原因代码的中文说明，供界面展示。 */
export const REASON_LABELS: Record<string, string> = {
  imported: '已导入',
  'file-too-large': '文件超过大小上限',
  'request-too-large': '请求体超过上限',
  'text-too-large': '解析文本超过字符上限',
  'page-limit': '页数超过上限',
  duplicate: '该文献已在当前课题中',
  'invalid-pdf': '不是有效 PDF',
  'no-text': '未提取到文字',
  'parse-failed': '文件解析失败',
  'project-full': '课题文献数已达上限',
  rejected: '服务端拒绝',
};

/** 字段提取结果的最小结构，供多段合并使用。 */
export type ExtractableCell = {
  fieldId: string;
  value: string;
  blockId: string;
  quote: string;
  note: string;
};

/**
 * 长文分段提取后的合并规则：
 * 同一字段只保留一条；优先保留有值且有原文摘录的那条。
 * 若不同段给出不同取值，保留其中一条并把差异写进 note，
 * 交由人工核对，不做静默取舍。
 */
export function mergeFieldCells<T extends ExtractableCell>(cells: T[]): T[] {
  const byField = new Map<string, T>();
  const conflicts = new Map<string, Set<string>>();
  const score = (c: ExtractableCell) =>
    (c.value?.trim() ? 1 : 0) + (c.quote?.trim() ? 1 : 0);
  for (const cell of cells) {
    const seen = byField.get(cell.fieldId);
    if (!seen) {
      byField.set(cell.fieldId, cell);
      continue;
    }
    if (score(cell) > score(seen)) byField.set(cell.fieldId, cell);
    if (cell.value?.trim() && seen.value?.trim() && cell.value !== seen.value) {
      const set = conflicts.get(cell.fieldId) ?? new Set<string>();
      set.add(seen.value);
      set.add(cell.value);
      conflicts.set(cell.fieldId, set);
    }
  }
  return [...byField.values()].map((cell) => {
    const values = conflicts.get(cell.fieldId);
    if (!values || values.size < 2) return cell;
    return {
      ...cell,
      note: `${cell.note ? cell.note + '\n' : ''}分段提取出现不同取值：${[...values].join(' / ')}，请人工核对。`,
    };
  });
}
