export type ScholarlyWork = {
  doi: string;
  title: string;
  authors: string[];
  year: number | null;
  source: string;
  type: string;
  abstract: string;
  references: string[];
  provider: 'Crossref' | 'BibTeX' | 'RIS' | 'EndNote XML';
  importedFrom?: { filename: string; hash: string; entry: number };
  retrievedAt: string;
  query: string;
};
export function cleanMetadata(value: unknown) {
  return typeof value === 'string'
    ? value
        .replace(/<[^>]*>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
    : '';
}
export function normalizeDOI(value: string) {
  return value
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .toLowerCase();
}
export function crossrefWork(input: unknown, query: string): ScholarlyWork {
  const w = input as Record<string, unknown>,
    authors = Array.isArray(w.author) ? w.author : [];
  const dates = (w.published || w.issued) as
    | { 'date-parts'?: number[][] }
    | undefined;
  return {
    doi: normalizeDOI(typeof w.DOI === 'string' ? w.DOI : ''),
    title: cleanMetadata(Array.isArray(w.title) ? w.title[0] : ''),
    authors: authors.slice(0, 50).map((a) => {
      const author = a as { given?: string; family?: string };
      return [author.given, author.family].filter(Boolean).join(' ');
    }),
    year: dates?.['date-parts']?.[0]?.[0] || null,
    source: cleanMetadata(
      Array.isArray(w['container-title']) ? w['container-title'][0] : '',
    ),
    type: cleanMetadata(w.type),
    abstract: cleanMetadata(w.abstract).slice(0, 30000),
    references: (Array.isArray(w.reference) ? w.reference : [])
      .flatMap((r) => {
        const doi = (r as { DOI?: string }).DOI;
        return doi ? [normalizeDOI(doi)] : [];
      })
      .slice(0, 200),
    provider: 'Crossref',
    retrievedAt: new Date().toISOString(),
    query,
  };
}
export async function searchCrossref(query: string): Promise<ScholarlyWork[]> {
  const doi = normalizeDOI(query),
    exact = /^10\.\d{4,9}\/\S+$/.test(doi);
  const url = exact
    ? `https://api.crossref.org/works/${encodeURIComponent(doi)}`
    : `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query)}&rows=12`;
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'ResearchWorkbench/2.0',
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new Error(
      response.status === 429
        ? 'Crossref 请求限流，请稍后重试。'
        : `Crossref 检索失败（HTTP ${response.status}）。可直接上传文献。`,
    );
  const data = (await response.json()) as { message: unknown };
  return (exact ? [data.message] : (data.message as { items: unknown[] }).items)
    .map((w) => crossrefWork(w, query))
    .filter((w) => w.doi && w.title);
}
const line = (s: string) => s.replace(/[\r\n]+/g, ' '),
  bib = (s: string) =>
    line(s).replace(/[{}\\]/g, (c) =>
      c === '\\' ? '\\textbackslash{}' : `\\${c}`,
    );
export function exportReferences(
  works: ScholarlyWork[],
  format: 'ris' | 'bibtex' | 'endnote',
) {
  if (format === 'endnote') {
    const xml = (value: string) =>
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<xml><records>${works.map((w) => `<record><ref-type name="${w.type === 'journal-article' ? 'Journal Article' : w.type === 'book' ? 'Book' : 'Generic'}">${w.type === 'journal-article' ? 17 : w.type === 'book' ? 6 : 13}</ref-type><contributors><authors>${w.authors.map((a) => `<author>${xml(a)}</author>`).join('')}</authors></contributors><titles><title>${xml(w.title)}</title><secondary-title>${xml(w.source)}</secondary-title></titles><periodical><full-title>${xml(w.source)}</full-title></periodical><dates>${w.year ? `<year>${w.year}</year>` : ''}</dates><electronic-resource-num>${xml(w.doi)}</electronic-resource-num><abstract>${xml(w.abstract)}</abstract></record>`).join('\n')}</records></xml>`;
  }
  if (format === 'ris')
    return works
      .map((w) =>
        [
          `TY  - ${w.type === 'journal-article' ? 'JOUR' : w.type === 'book' ? 'BOOK' : 'GEN'}`,
          `TI  - ${line(w.title)}`,
          ...w.authors.map((a) => `AU  - ${line(a)}`),
          ...(w.year ? [`PY  - ${w.year}`] : []),
          `JO  - ${line(w.source)}`,
          `DO  - ${line(w.doi)}`,
          `AB  - ${line(w.abstract)}`,
          'ER  -',
          '',
        ].join('\r\n'),
      )
      .join('\r\n');
  return works
    .map(
      (w, i) =>
        `@${w.type === 'journal-article' ? 'article' : w.type === 'book' ? 'book' : 'misc'}{work${i + 1},\n  title = {${bib(w.title)}},\n  author = {${w.authors.map((a) => `{${bib(a)}}`).join(' and ')}},\n  year = {${w.year ?? ''}},\n  journal = {${bib(w.source)}},\n  doi = {${bib(w.doi)}},\n  abstract = {${bib(w.abstract)}}\n}`,
    )
    .join('\n\n');
}
