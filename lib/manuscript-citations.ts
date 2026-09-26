import type { Review, Paper } from './domain';
import type { SourceReference } from './source-reference';
import { sha256 } from './graph.ts';
export type CitationBinding = {
  manuscriptVersionId: string;
  manuscriptHash: string;
  text: string;
  start: number;
  end: number;
  source: SourceReference;
  actor: string;
  at: string;
  reason: string;
};
export type ManuscriptCitation = CitationBinding & {
  id: string;
  status: 'linked' | 'stale' | 'withdrawn';
  history: {
    binding: CitationBinding;
    status: ManuscriptCitation['status'];
    actor: string;
    at: string;
    reason: string;
  }[];
};
export function citationStatus(
  c: ManuscriptCitation,
  review: Review,
  papers: Paper[],
) {
  if (c.status === 'withdrawn') return 'withdrawn';
  const paper = papers.find((p) => p.id === c.source.paperId);
  if (
    c.status === 'stale' ||
    !paper ||
    paper.hash !== c.source.documentHash ||
    (paper.parsing && paper.parsing.hash !== c.source.parseHash) ||
    (paper.parseVersionId ?? 'original') !== c.source.parseVersionId ||
    (review.versions?.at(-1)?.id ?? 'legacy') !== c.manuscriptVersionId ||
    review.newText.slice(c.start, c.end) !== c.text
  )
    return 'stale';
  return 'linked';
}
export function citationSnapshot(c: ManuscriptCitation): CitationBinding {
  const { id: _id, status: _status, history: _history, ...binding } = c;
  return structuredClone(binding);
}
export async function makeManuscriptAnchor(review: Review, text: string) {
  const excerpt = text.trim(),
    start = review.newText.indexOf(excerpt);
  if (!excerpt || excerpt.length > 3000 || start < 0)
    throw new Error('稿件表述必须是已保存新稿中的连续原句。');
  if (review.newText.indexOf(excerpt, start + 1) >= 0)
    throw new Error('这段表述在稿件中重复，请扩大选段以唯一定位。');
  return {
    manuscriptVersionId: review.versions?.at(-1)?.id ?? 'legacy',
    manuscriptHash: await sha256(review.newText),
    text: excerpt,
    start,
    end: start + excerpt.length,
  };
}
export async function makeCitationBinding(
  review: Review,
  text: string,
  source: SourceReference,
  actor: string,
  reason: string,
): Promise<CitationBinding> {
  const anchor = await makeManuscriptAnchor(review, text);
  if (!reason.trim()) throw new Error('请填写引用核对说明。');
  return {
    ...anchor,
    source: structuredClone(source),
    actor,
    at: new Date().toISOString(),
    reason: reason.trim(),
  };
}
export function saveCitation(
  review: Review,
  binding: CitationBinding,
  id?: string,
) {
  review.citations ??= [];
  if (id) {
    const c = review.citations.find((c) => c.id === id);
    if (!c) throw new Error('稿件引用不存在。');
    if (c.history.length >= 100)
      throw new Error('此引用已达100次变更，历史未删除。');
    c.history.push({
      binding: citationSnapshot(c),
      status: c.status,
      actor: binding.actor,
      at: binding.at,
      reason: binding.reason,
    });
    Object.assign(c, binding, { status: 'linked' });
  } else {
    if (review.citations.length >= 100)
      throw new Error('稿件已达100条引用记录，历史未删除。');
    review.citations.push({
      ...binding,
      id: crypto.randomUUID(),
      status: 'linked',
      history: [],
    });
  }
}
export function withdrawCitation(
  review: Review,
  id: string,
  actor: string,
  reason: string,
) {
  const c = review.citations?.find((c) => c.id === id);
  if (!c) throw new Error('稿件引用不存在。');
  if (!reason.trim()) throw new Error('请填写撤回原因。');
  if (c.status === 'withdrawn') throw new Error('这条引用已经撤回。');
  if (c.history.length >= 100)
    throw new Error('此引用已达100次变更，历史未删除。');
  c.history.push({
    binding: citationSnapshot(c),
    status: c.status,
    actor,
    at: new Date().toISOString(),
    reason: reason.trim(),
  });
  c.status = 'withdrawn';
}
