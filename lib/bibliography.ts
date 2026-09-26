import { plugins } from '@citation-js/core';
import '@citation-js/plugin-bibtex';
import { XMLParser } from 'fast-xml-parser';
import { SyntaxValidator } from 'fast-xml-validator';
import { normalizeDOI, type ScholarlyWork } from './scholar.ts';
import type { Paper } from './domain';

export type BibliographyFormat = 'bibtex' | 'ris' | 'endnote';
export type BibliographyEntry = {
  index: number;
  work: ScholarlyWork;
  warnings: string[];
  error: string;
  duplicate: string;
};
type Fields = Record<string, string[]>;
const cleanMetadata = (value: unknown) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const yearOf = (value: unknown) => {
  const match = (
    typeof value === 'number' || typeof value === 'string' ? String(value) : ''
  ).match(/^\s*(\d{4})(?:\D|$)/);
  return match && Number(match[1]) > 0 ? Number(match[1]) : null;
};
function ris(text: string): Record<string, unknown>[] {
  const records: Fields[] = [];
  let record: Fields | null = null,
    last = '';
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const tag = line.match(/^([A-Z0-9]{2}) {2}- ?(.*)$/);
    if (!tag) {
      if (!record || !last || !/^\s/.test(line))
        throw new Error(
          'RIS 行格式不完整，请使用 TY / ER 包围的标准 RIS 条目。',
        );
      record[last][record[last].length - 1] += '\n' + line.trim();
      continue;
    }
    const [, key, value] = tag;
    if (key === 'TY') {
      if (record) throw new Error('RIS 条目缺少 ER 结束标记。');
      record = { TY: [value] };
    } else if (key === 'ER') {
      if (!record) throw new Error('RIS 结束标记没有对应条目。');
      records.push(record);
      record = null;
    } else {
      if (!record) throw new Error('RIS 字段出现在条目之外。');
      (record[key] ??= []).push(value);
    }
    last = key;
  }
  if (record) throw new Error('RIS 最后一条缺少 ER 结束标记。');
  return records.map((r) => ({
    title: (r.TI || r.T1 || r.CT)?.[0],
    DOI: r.DO?.[0],
    author: (r.AU || r.A1 || []).map((literal) => ({ literal })),
    year: yearOf((r.PY || r.Y1 || r.DA)?.[0]),
    'container-title': (r.JO || r.JF || r.T2 || r.JA)?.[0],
    abstract: (r.AB || r.N2)?.join('\n'),
    type:
      r.TY[0] === 'JOUR'
        ? 'article-journal'
        : r.TY[0] === 'BOOK'
          ? 'book'
          : 'document',
  }));
}
type XmlNode = Record<string, unknown>;
function xmlText(input: unknown): string {
  if (typeof input === 'string') return input;
  if (Array.isArray(input)) return input.map(xmlText).join('');
  if (input && typeof input === 'object')
    return Object.entries(input)
      .filter(([key]) => key !== ':@' && !key.startsWith('?'))
      .map(([, value]) => xmlText(value))
      .join('');
  return '';
}
function xmlFind(input: unknown, path: string): unknown[] {
  const [tag, ...rest] = path.split('/');
  const found = (Array.isArray(input) ? input : []).flatMap((n) =>
    n && typeof n === 'object' && tag in n ? [(n as XmlNode)[tag]] : [],
  );
  return rest.length ? found.flatMap((n) => xmlFind(n, rest.join('/'))) : found;
}
function endnote(text: string): Record<string, unknown>[] {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text))
    throw new Error(
      '不接受含 DTD 或实体声明的 XML，请重新导出标准 EndNote XML。',
    );
  if (SyntaxValidator.validate(text) !== true)
    throw new Error('XML 格式不完整，请检查原始导出文件。');
  const tree: unknown = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    parseTagValue: false,
    trimValues: false,
  }).parse(text);
  const records = [
    ...xmlFind(tree, 'xml/records/record'),
    ...xmlFind(tree, 'records/record'),
  ];
  if (!records.length)
    throw new Error(
      '没有找到 EndNote XML records/record 条目；不支持 .enl 私有库文件。',
    );
  return records.map((record) => {
    const value = (path: string) => xmlText(xmlFind(record, path));
    const type = value('ref-type').trim();
    return {
      title: value('titles/title'),
      DOI: value('electronic-resource-num'),
      author: xmlFind(record, 'contributors/authors/author').map((a) => ({
        literal: xmlText(a),
      })),
      year: yearOf(value('dates/year')),
      'container-title':
        value('periodical/full-title') || value('titles/secondary-title'),
      abstract: value('abstract'),
      type: ['17', '43'].includes(type)
        ? 'article-journal'
        : ['6', '28', '44'].includes(type)
          ? 'book'
          : 'document',
    };
  });
}

export function parseBibliography(
  text: string,
  format: BibliographyFormat,
  filename: string,
  at = new Date().toISOString(),
): BibliographyEntry[] {
  if (new TextEncoder().encode(text).length > 500000)
    throw new Error('书目文件最大500KB，请分批导入。');
  if (!text.trim()) throw new Error('书目文件为空。');
  const raw =
    format === 'bibtex'
      ? plugins.input.chain(text, {
          // BibLaTeX's compatible superset retains common abstract fields omitted by strict BibTeX mapping.
          forceType: '@biblatex/text',
          generateGraph: false,
        })
      : format === 'ris'
        ? ris(text)
        : endnote(text);
  if (!raw.length || raw.length > 200)
    throw new Error('每次预览需包含1至200条书目。');
  return raw.map((r, index) => {
    const warnings: string[] = [];
    const rawDoi = typeof r.DOI === 'string' ? r.DOI : '';
    const normalized = normalizeDOI(rawDoi),
      doi = /^10\.\d{4,9}\/\S+$/.test(normalized) ? normalized : '';
    if (rawDoi && !doi) warnings.push('DOI 格式无效，原值保留在原始文件中');
    if (!doi) warnings.push('缺少可用 DOI，请核对作品身份');
    const authors = (Array.isArray(r.author) ? r.author : [])
      .map((a) => {
        const author = a as Record<string, unknown>;
        return cleanMetadata(
          author.literal ||
            [
              author.given,
              author['non-dropping-particle'],
              author.family,
              author.suffix,
            ]
              .filter(Boolean)
              .join(' '),
        );
      })
      .filter(Boolean);
    const dates = r.issued as { 'date-parts'?: number[][] } | undefined;
    const work: ScholarlyWork = {
      doi,
      title: cleanMetadata(r.title),
      authors,
      year: yearOf(r.year ?? dates?.['date-parts']?.[0]?.[0]),
      source: cleanMetadata(r['container-title']),
      type:
        r.type === 'article-journal'
          ? 'journal-article'
          : typeof r.type === 'string'
            ? r.type
            : 'document',
      abstract: cleanMetadata(r.abstract),
      references: [],
      provider:
        format === 'bibtex'
          ? 'BibTeX'
          : format === 'ris'
            ? 'RIS'
            : 'EndNote XML',
      retrievedAt: at,
      query: filename,
    };
    if (!authors.length) warnings.push('作者未知');
    if (!work.year) warnings.push('年份未知');
    let error = work.title ? '' : '缺少标题，不能导入';
    if (
      work.title.length > 1800 ||
      work.abstract.length > 30000 ||
      authors.length > 100
    )
      error = '条目超出支持长度，请拆分或修订后导入；不会静默截断';
    return { index, work, warnings, error, duplicate: '' };
  });
}

export function checkBibliographyDuplicates(
  entries: BibliographyEntry[],
  papers: Paper[],
) {
  const seen = new Map<string, string>();
  for (const paper of papers)
    if (paper.metadata?.doi)
      seen.set(normalizeDOI(paper.metadata.doi), `已入库：${paper.title}`);
  const titleKey = (s: string) =>
    s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const titles = new Set(papers.map((p) => titleKey(p.title)));
  return entries.map((entry) => {
    const e = { ...entry, warnings: [...entry.warnings] };
    if (e.work.doi && seen.has(e.work.doi)) e.duplicate = seen.get(e.work.doi)!;
    if (titles.has(titleKey(e.work.title)))
      e.warnings.push('存在同标题记录，请核对是否为同一作品或不同版本');
    if (!e.error && e.work.doi && !e.duplicate)
      seen.set(e.work.doi, `与文件中第${e.index + 1}条 DOI 相同`);
    titles.add(titleKey(e.work.title));
    return e;
  });
}
