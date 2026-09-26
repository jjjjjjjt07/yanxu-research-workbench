import type { Review } from './domain';
export type ManuscriptVersion = {
  id: string;
  number: number;
  at: string | null;
  importedAt?: string;
  author: string;
  legacy: boolean;
  oldText: string;
  newText: string;
  feedback: string;
  restoredFrom?: string;
};
export function saveManuscript(
  review: Review,
  patch: { oldText: string; newText: string; feedback: string },
  author: string,
  restoredFrom?: string,
) {
  const changed =
    patch.oldText !== review.oldText ||
    patch.newText !== review.newText ||
    patch.feedback !== review.feedback;
  if (!changed && !restoredFrom) return false;
  review.versions ??= [];
  if (
    !review.versions.length &&
    (review.oldText || review.newText || review.feedback)
  )
    review.versions.push({
      id: crypto.randomUUID(),
      number: 1,
      at: null,
      importedAt: new Date().toISOString(),
      author: '未知',
      legacy: true,
      oldText: review.oldText,
      newText: review.newText,
      feedback: review.feedback,
    });
  for (const citation of review.citations ?? [])
    if (citation.status !== 'withdrawn') citation.status = 'stale';
  for (const citation of review.observationCitations ?? [])
    if (citation.status !== 'withdrawn') citation.status = 'stale';
  if (review.oldText || review.newText || review.feedback)
    review.history.push({
      at: new Date().toISOString(),
      oldText: review.oldText,
      newText: review.newText,
      feedback: review.feedback,
      items: structuredClone(review.items),
    });
  review.versions.push({
    id: crypto.randomUUID(),
    number: review.versions.length + 1,
    at: new Date().toISOString(),
    author,
    legacy: false,
    oldText: patch.oldText,
    newText: patch.newText,
    feedback: patch.feedback,
    ...(restoredFrom ? { restoredFrom } : {}),
  });
  Object.assign(review, {
    oldText: patch.oldText,
    newText: patch.newText,
    feedback: patch.feedback,
    items: [],
    analyzedHash: '',
  });
  return true;
}
