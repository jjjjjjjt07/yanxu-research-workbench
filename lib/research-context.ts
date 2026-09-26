import type { Project, Block } from './domain';
import { noteSourceStatus } from './source-reference.ts';
import { observationContext } from './observation-reference.ts';

export function researchContext(p: Project, observationIds: string[] = []) {
  return {
    ...(observationIds.length
      ? { experimentObservations: observationContext(p.state, observationIds) }
      : {}),
    title: p.title,
    question: p.question,
    equipment: p.state.profile?.equipment || '未填写',
    currentMethod: p.state.profile?.currentMethod || '未填写',
    constraints: p.state.profile?.constraints || '未填写',
    // These are user observations, not independently verified paper evidence.
    readingFeedback: (p.state.readingFeedback ?? []).map((r) => ({
      ...r,
      papers: r.paperIds.map(
        (id) => p.state.papers.find((paper) => paper.id === id)?.title ?? id,
      ),
    })),
    notes: p.state.notes.map((n) => ({
      id: n.id,
      paperId: n.paperId,
      text: n.text,
      at: n.at,
      sourceStatus: noteSourceStatus(n, p.state.papers),
      sourceNeedsReview: ['stale', 'legacy'].includes(
        noteSourceStatus(n, p.state.papers),
      ),
      source: ['linked', 'reviewed'].includes(
        noteSourceStatus(n, p.state.papers),
      )
        ? n.source
        : undefined,
      interpretation:
        '个人阅读观察；来源核对不表示笔记结论已被证实。旧来源不可作为当前原文证据。',
      paperTitle: p.state.papers.find((paper) => paper.id === n.paperId)?.title,
    })),
  };
}

// Balanced per-paper budget: a long first paper cannot crowd out later papers.
// Expose coverage to the UI; retrieved excerpts are never described as full text.
export function selectReadingBlocks(
  blocks: Block[],
  query: string,
  budget: number,
) {
  const terms = [
    ...new Set(
      (
        query.toLowerCase().match(/[a-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g) ?? []
      ).flatMap((t) =>
        /[\u4e00-\u9fff]/.test(t)
          ? [
              t,
              ...Array.from({ length: Math.max(0, t.length - 1) }, (_, i) =>
                t.slice(i, i + 2),
              ),
            ]
          : [t],
      ),
    ),
  ];
  if (blocks.reduce((n, b) => n + b.text.length, 0) <= budget) return blocks;
  const ranked = blocks
    .map((block, index) => ({
      block,
      index,
      score:
        terms.reduce(
          (sum, term) =>
            sum + (block.text.toLowerCase().includes(term) ? 1 : 0),
          0,
        ) + (index < 2 ? 0.5 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  let remaining = budget;
  const selected: typeof ranked = [];
  for (const item of ranked) {
    if (item.block.text.length > remaining) continue;
    selected.push(item);
    remaining -= item.block.text.length;
  }
  return selected.sort((a, b) => a.index - b.index).map((x) => x.block);
}
