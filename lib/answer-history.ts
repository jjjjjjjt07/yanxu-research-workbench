import type { Project } from './domain';
import type { ReadingAnswer } from './reading-answer';
export type AnswerInput = {
  paperId: string;
  documentHash: string;
  parseHash: string;
  parseVersionId: string;
};
export type AnswerRecord = {
  observationIds?: string[];
  id: string;
  at: string;
  question: string;
  mode: 'analysis' | 'excerpts';
  model: string | null;
  projectRevision: number;
  contextHash: string;
  contextSnapshot: unknown;
  inputs: AnswerInput[];
  result: ReadingAnswer;
};
export function answerPrefix(owner: string, projectId: string) {
  return `${encodeURIComponent(owner)}/${projectId}/answers/`;
}
export function answerStatus(
  record: AnswerRecord,
  project: Project,
  contextHash: string,
  parseHashes: Record<string, string>,
) {
  const stalePaperIds = record.inputs
    .filter((input) => {
      const paper = project.state.papers.find((p) => p.id === input.paperId);
      return (
        !paper ||
        paper.hash !== input.documentHash ||
        parseHashes[input.paperId] !== input.parseHash ||
        (paper.parseVersionId ?? 'original') !== input.parseVersionId
      );
    })
    .map((i) => i.paperId);
  const contextChanged = record.contextHash !== contextHash;
  return {
    stalePaperIds,
    contextChanged,
    needsReview: !!stalePaperIds.length || contextChanged,
  };
}
