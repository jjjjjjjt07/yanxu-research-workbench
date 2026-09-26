import type { AnswerRecord } from './answer-history';
import type { SourceReference } from './source-reference';
import type { Graph, Evidence } from './graph';
import type { ProjectState } from './domain';
import { sourceEvidenceMatches } from './evidence-links.ts';

export type AnswerEvidenceBinding = {
  answerId: string;
  sourceIndex: number;
  source: SourceReference;
  actor: string;
  at: string;
  reason: string;
};
export type AnswerEvidenceLink = AnswerEvidenceBinding & {
  status: 'linked' | 'stale' | 'withdrawn';
  history: (AnswerEvidenceBinding & { status: AnswerEvidenceLink['status'] })[];
};

// Only an exact, versioned source can be explicitly associated. Similar text is not identity.
export function answerEvidenceMatches(
  record: AnswerRecord,
  index: number,
  evidence: Evidence,
) {
  const source = record.result.sources[index];
  const ref = source?.reference;
  return (
    !!ref &&
    source.paperId === ref.paperId &&
    source.blockId === ref.blockId &&
    source.page === ref.page &&
    source.quote === ref.quote &&
    sourceEvidenceMatches(
      { ...ref, graphEvidence: { id: evidence.id, graphRevision: 0 } },
      evidence,
    )
  );
}

export function saveAnswerEvidence(
  state: ProjectState,
  binding: AnswerEvidenceBinding,
  withdraw = false,
) {
  if (!binding.reason.trim()) throw new Error('请填写关联核对或撤回说明。');
  const links = state.answerEvidenceLinks ?? [];
  const index = links.findIndex(
    (l) =>
      l.answerId === binding.answerId && l.sourceIndex === binding.sourceIndex,
  );
  const prior = links[index];
  if (withdraw && (!prior || prior.status === 'withdrawn'))
    throw new Error('当前没有可撤回的图谱关联。');
  if (!prior && links.length >= 200)
    throw new Error('问答图谱关联已达200条，已有记录未覆盖。');
  if (prior && prior.history.length >= 100)
    throw new Error('关联历史已达100条，已有记录未覆盖。');
  const history = prior
    ? [
        ...prior.history,
        (({ history: _history, ...snapshot }) => structuredClone(snapshot))(
          prior,
        ),
      ]
    : [];
  const next: AnswerEvidenceLink = {
    ...structuredClone(
      withdraw && prior
        ? {
            ...prior,
            actor: binding.actor,
            at: binding.at,
            reason: binding.reason,
          }
        : binding,
    ),
    status: withdraw ? 'withdrawn' : 'linked',
    history,
  };
  if (index < 0) links.push(next);
  else links[index] = next;
  state.answerEvidenceLinks = links;
  return next;
}

export function answerGraphLinks(
  state: ProjectState,
  graph: Graph,
  answerId: string,
) {
  return (state.answerEvidenceLinks ?? [])
    .filter((l) => l.answerId === answerId)
    .map((link) => {
      const paper = state.papers.find((p) => p.id === link.source.paperId);
      const stale =
        !paper ||
        paper.hash !== link.source.documentHash ||
        (paper.parseVersionId ?? 'original') !== link.source.parseVersionId ||
        (!!paper.parsing && paper.parsing.hash !== link.source.parseHash) ||
        !sourceEvidenceMatches(
          link.source,
          graph.evidence.find((e) => e.id === link.source.graphEvidence?.id),
        );
      return {
        ...link,
        status:
          link.status === 'linked' && stale ? ('stale' as const) : link.status,
      };
    });
}
