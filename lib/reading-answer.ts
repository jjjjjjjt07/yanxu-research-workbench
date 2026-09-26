import type { SourceReference } from './source-reference';
export function qualifiedSupport(
  kind: string,
  support: string,
  usesObservations: boolean,
) {
  if (kind === 'unknown') return 'unknown';
  if (
    support === 'supported' &&
    (usesObservations || kind === 'inference' || kind === 'calculation')
  )
    return 'partial';
  return support;
}
export type ReadingAnswer = {
  observations?: import('./observation-reference').ObservationReference[];
  statements?: {
    observationIndices?: number[];
    text: string;
    kind: string;
    sourceIndices: number[];
    support: string;
    reason: string;
    needsReview: boolean;
  }[];
  savedAnswerId?: string;
  persistenceError?: string;
  sourceNeedsReview?: boolean;
  answer: string;
  sources: {
    paperId: string;
    paperTitle: string;
    blockId: string;
    page: number;
    quote: string;
    reference?: SourceReference;
  }[];
  unverified: boolean;
  context: {
    profile?: unknown;
    title: string;
    question: string;
    feedbackCount: number;
    noteCount: number;
  };
  coverage: {
    paperId: string;
    title: string;
    mode: string;
    includedBlocks: number;
    totalBlocks: number;
    parsing?: {
      textLayerOnly: boolean;
      missingPages: number[];
      qualityWarnings: string[];
    };
  }[];
};
