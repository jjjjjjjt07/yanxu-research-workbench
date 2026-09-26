import type { Block, Paper } from './domain';
import { sha256 } from './graph.ts';

// Immutable source snapshot; a matching quote is not a proof of the note's claim.
export type SourceReference = {
  graphEvidence?: { id: string; graphRevision: number };
  paperId: string;
  documentHash: string;
  parseHash: string;
  parseVersionId: string;
  blockId: string;
  page: number;
  quote: string;
  rect?: number[];
  width?: number;
  height?: number;
  review?: { actor: string; at: string; reason: string };
};
export type ReadingNote = {
  id: string;
  paperId: string;
  blockId: string;
  text: string;
  at: string;
  sourceNeedsReview?: boolean;
  source?: SourceReference;
  sourceHistory?: {
    source?: SourceReference;
    blockId: string;
    sourceNeedsReview: boolean;
    actor: string;
    at: string;
    reason: string;
  }[];
};
export async function captureSource(
  paper: Paper,
  blocks: Block[],
  blockId: string,
  quote?: string,
): Promise<SourceReference> {
  const block = blocks.find((b) => b.id === blockId);
  if (!block) throw new Error('原文片段不存在，请重新选择。');
  const excerpt = (quote ?? block.text).trim();
  if (!excerpt || excerpt.length > 6000 || !block.text.includes(excerpt))
    throw new Error('摘录必须是所选片段中连续的原文，且不超过6000字符。');
  const parseHash = await sha256(JSON.stringify(blocks));
  if (paper.parsing && parseHash !== paper.parsing.hash)
    throw new Error('解析文件与当前版本不一致，请刷新后重试。');
  return {
    paperId: paper.id,
    documentHash: paper.hash,
    parseHash,
    parseVersionId: paper.parseVersionId ?? 'original',
    blockId,
    page: block.page,
    quote: excerpt,
    ...(block.rect
      ? { rect: [...block.rect], width: block.width, height: block.height }
      : {}),
  };
}
export function noteSourceStatus(note: ReadingNote, papers: Paper[]) {
  if (!note.blockId) return 'observation' as const;
  if (!note.source) return 'legacy' as const;
  const paper = papers.find((p) => p.id === note.paperId);
  if (
    note.sourceNeedsReview ||
    note.source.paperId !== note.paperId ||
    note.source.blockId !== note.blockId ||
    !paper ||
    paper.hash !== note.source.documentHash ||
    (paper.parsing && paper.parsing.hash !== note.source.parseHash)
  )
    return 'stale' as const;
  return note.source.review ? ('reviewed' as const) : ('linked' as const);
}
export function rebindNote(
  note: ReadingNote,
  source: SourceReference,
  actor: string,
  at: string,
  reason: string,
) {
  if (!reason.trim()) throw new Error('请填写来源核对说明。');
  if (source.paperId !== note.paperId)
    throw new Error('请选择这条笔记所属文献的原文。');
  if ((note.sourceHistory?.length ?? 0) >= 100)
    throw new Error('来源变更历史已达100条，未删除旧记录。');
  note.sourceHistory ??= [];
  note.sourceHistory.push({
    source: note.source ? structuredClone(note.source) : undefined,
    blockId: note.blockId,
    sourceNeedsReview: !!note.sourceNeedsReview,
    actor,
    at,
    reason: reason.trim(),
  });
  note.source = { ...source, review: { actor, at, reason: reason.trim() } };
  note.blockId = source.blockId;
  note.sourceNeedsReview = false;
}
