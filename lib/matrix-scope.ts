import type { Project } from './domain';

// An explicit empty scope must not expand to the whole project.
export function selectMatrixPapers(
  project: Project,
  query = '',
  paperIds?: string[],
) {
  const allowed = paperIds === undefined ? null : new Set(paperIds);
  const text = query.trim().toLowerCase();
  return project.state.papers.filter(
    (paper) =>
      (!allowed || allowed.has(paper.id)) &&
      (
        paper.title +
        ' ' +
        project.state.cells
          .filter((cell) => cell.paperId === paper.id)
          .map((cell) => cell.value)
          .join(' ')
      )
        .toLowerCase()
        .includes(text),
  );
}
