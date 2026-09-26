import {
  cellSnapshot,
  now,
  type CellValue,
  type ProjectState,
} from './domain.ts';
import type { Evidence, Graph } from './graph';
import type { SourceReference } from './source-reference';

export function sourceEvidenceMatches(
  source: SourceReference,
  evidence?: Evidence,
) {
  return (
    !!source.graphEvidence &&
    !!evidence &&
    source.graphEvidence.id === evidence.id &&
    source.paperId === evidence.paperId &&
    source.documentHash === evidence.documentHash &&
    source.parseHash === evidence.parseHash &&
    source.blockId === evidence.blockId &&
    source.page === evidence.page &&
    source.quote === evidence.quote
  );
}

export function evidenceLinkMatches(
  value: CellValue,
  paperId: string,
  evidence?: Evidence,
) {
  const ref = value.evidenceRef;
  return (
    !!ref &&
    !!evidence &&
    ref.id === evidence.id &&
    paperId === evidence.paperId &&
    ref.documentHash === evidence.documentHash &&
    ref.parseHash === evidence.parseHash &&
    value.blockId === evidence.blockId &&
    value.page === evidence.page &&
    value.quote === evidence.quote
  );
}

// Keep reviewed values and historical references intact; changes only withdraw validity.
export function invalidateEvidenceLinks(state: ProjectState, graph: Graph) {
  let changed = 0;
  const evidence = new Map(graph.evidence.map((e) => [e.id, e]));
  const reason = '关联图谱证据已变化或移除，请重新核对原文。';
  const mismatched = (source: SourceReference) => {
    const paper = state.papers.find((p) => p.id === source.paperId);
    return (
      !paper ||
      paper.hash !== source.documentHash ||
      (!!paper.parsing && paper.parsing.hash !== source.parseHash) ||
      !sourceEvidenceMatches(source, evidence.get(source.graphEvidence!.id))
    );
  };
  let notesChanged = false;
  for (const note of state.notes ?? []) {
    if (
      note.source?.graphEvidence &&
      !note.sourceNeedsReview &&
      mismatched(note.source)
    ) {
      note.sourceNeedsReview = true;
      notesChanged = true;
      changed++;
    }
  }
  if (notesChanged) state.contextVersion = (state.contextVersion ?? 1) + 1;
  for (const citation of state.review?.citations ?? []) {
    if (
      citation.source.graphEvidence &&
      citation.status === 'linked' &&
      mismatched(citation.source)
    ) {
      citation.status = 'stale';
      changed++;
    }
  }
  for (const link of state.answerEvidenceLinks ?? []) {
    if (link.status === 'linked' && mismatched(link.source)) {
      link.status = 'stale';
      changed++;
    }
  }
  for (const cell of state.cells) {
    const parseHash = state.papers.find((p) => p.id === cell.paperId)?.parsing
      ?.hash;
    if (
      cell.evidenceRef &&
      cell.sourceValid &&
      ((parseHash && parseHash !== cell.evidenceRef.parseHash) ||
        !evidenceLinkMatches(
          cell,
          cell.paperId,
          evidence.get(cell.evidenceRef.id),
        ))
    ) {
      cell.history.push({
        at: now(),
        value: cellSnapshot(cell),
        status: cell.status,
        reason,
      });
      cell.sourceValid = false;
      cell.status = 'stale';
      changed++;
    }
    const candidate = cell.candidate;
    if (
      candidate?.evidenceRef &&
      candidate.sourceValid &&
      ((parseHash && parseHash !== candidate.evidenceRef.parseHash) ||
        !evidenceLinkMatches(
          candidate,
          cell.paperId,
          evidence.get(candidate.evidenceRef.id),
        ))
    ) {
      candidate.sourceValid = false;
      candidate.note = `${candidate.note}\n${reason}`.trim();
      changed++;
    }
  }
  return changed;
}
