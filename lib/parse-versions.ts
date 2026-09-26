import {
  cellSnapshot,
  now,
  type Block,
  type Paper,
  type ProjectState,
} from './domain.ts';
import { LIMITS } from './limits.ts';
import type { Graph } from './graph';
import type { PageQuality } from './pdf-layout';

export type ParseVersion = {
  ocr?: {
    previewId: string;
    model: string;
    imageHash: string;
    page: number;
    warnings: string[];
  };
  id: string;
  hash: string;
  at: string | null;
  actor: string | null;
  reason: string;
  engine: string;
  pages: PageQuality[];
  restoredFrom?: string;
};
export function parseFileSuffix(id?: string) {
  if (!id || id === 'original') return 'blocks.json';
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid parse version ID');
  return `parse-${id}.json`;
}
export function correctBlock(blocks: Block[], id: string, text: string) {
  if (!blocks.some((b) => b.id === id)) throw new Error('片段不存在，请刷新。');
  if (!text.trim() || text.length > LIMITS.blockChars)
    throw new Error(`片段须有文字且不超过${LIMITS.blockChars}字符。`);
  const next = blocks.map((b) => (b.id === id ? { ...b, text } : { ...b }));
  if (next.reduce((n, b) => n + b.text.length, 0) > LIMITS.maxTotalChars)
    throw new Error(
      `解析文字超过${LIMITS.maxTotalChars.toLocaleString('en-US')}字符，请拆分文献。`,
    );
  return next;
}
export function invalidatePaperSources(state: ProjectState, paperId: string) {
  for (const o of state.observations ?? [])
    if (
      o.status === 'recorded' &&
      o.hypothesis?.snapshot.evidence.some((e) => e.paperId === paperId)
    )
      o.status = 'stale';
  for (const link of state.answerEvidenceLinks ?? [])
    if (link.source.paperId === paperId && link.status !== 'withdrawn')
      link.status = 'stale';
  for (const citation of state.review?.citations ?? [])
    if (citation.source.paperId === paperId && citation.status !== 'withdrawn')
      citation.status = 'stale';
  const reason = '解析文本版本已变化，请重新核对原文。';
  for (const cell of state.cells.filter((c) => c.paperId === paperId)) {
    if (cell.sourceValid || (cell.value && cell.status !== 'stale')) {
      cell.history.push({
        at: now(),
        value: cellSnapshot(cell),
        status: cell.status,
        reason,
      });
      cell.sourceValid = false;
      cell.status = 'stale';
    }
    if (cell.candidate?.sourceValid) {
      cell.candidate.sourceValid = false;
      cell.candidate.note = `${cell.candidate.note}\n${reason}`.trim();
    }
  }
  for (const note of state.notes.filter(
    (n) => n.paperId === paperId && n.blockId,
  ))
    note.sourceNeedsReview = true;
}
export function invalidateGraphParses(graph: Graph, papers: Paper[]) {
  const oldEvidence = new Set(
    graph.evidence
      .filter((e) => {
        const paper = papers.find((p) => p.id === e.paperId);
        return !!paper?.parsing && paper.parsing.hash !== e.parseHash;
      })
      .map((e) => e.id),
  );
  const relations = new Set<string>();
  for (const relation of graph.relations)
    if (relation.evidenceIds.some((id) => oldEvidence.has(id))) {
      relations.add(relation.id);
      if (relation.status !== 'rejected') relation.status = 'stale';
    }
  for (const bridge of graph.bridges)
    if (
      bridge.evidenceIds.some((id) => oldEvidence.has(id)) ||
      bridge.relationIds.some((id) => relations.has(id))
    )
      bridge.status = 'stale';
}
