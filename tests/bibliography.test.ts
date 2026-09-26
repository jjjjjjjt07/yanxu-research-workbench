import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseBibliography,
  checkBibliographyDuplicates,
} from '../lib/bibliography.ts';
import { exportReferences, type ScholarlyWork } from '../lib/scholar.ts';
import type { Paper } from '../lib/domain.ts';
void test('BibTeX parses nested braces, string macros, names and Unicode without inventing identifiers', () => {
  const entries = parseBibliography(
    '@string{journalname="Journal of Tests"}\n@article{one,title={Graph {Neural} Models},author={Doe, Jane and {研发团队}},journal=journalname,year=2024,abstract={x < 2 and y > 3}}',
    'bibtex',
    'test.bib',
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].work.title, 'Graph Neural Models');
  assert.deepEqual(entries[0].work.authors, ['Jane Doe', '研发团队']);
  assert.equal(entries[0].work.source, 'Journal of Tests');
  assert.equal(entries[0].work.abstract, 'x < 2 and y > 3');
  assert.equal(entries[0].work.doi, '');
  assert.equal(entries[0].work.provider, 'BibTeX');
});
void test('RIS recognizes authors, continuation lines and missing data, rejects incomplete records', () => {
  const [entry] = parseBibliography(
    'TY  - JOUR\r\nTI  - Synthetic paper\r\nAU  - Doe, Jane\r\nAU  - 研发团队\r\nAB  - First line\r\n  second line\r\nDO  - https://doi.org/10.1234/ABC\r\nER  -',
    'ris',
    'test.ris',
  );
  assert.equal(entry.work.abstract, 'First line second line');
  assert.equal(entry.work.doi, '10.1234/abc');
  assert.equal(entry.work.year, null);
  assert.equal(entry.work.authors.length, 2);
  assert.throws(() =>
    parseBibliography('TY  - JOUR\nTI  - unfinished', 'ris', 'bad.ris'),
  );
});
void test('EndNote XML preserves styled mixed text in order and rejects invalid XML or entity declarations', () => {
  const [entry] = parseBibliography(
    '<xml><records><record><ref-type name="Journal Article">17</ref-type><titles><title>Before <style face="italic">middle</style> after &amp; 研发</title></titles><contributors><authors><author>Doe, Jane</author></authors></contributors><dates><year>2024</year></dates><abstract>x &lt; 2 and y &gt; 3</abstract></record></records></xml>',
    'endnote',
    'test.xml',
  );
  assert.equal(entry.work.title, 'Before middle after & 研发');
  assert.equal(entry.work.abstract, 'x < 2 and y > 3');
  assert.equal(entry.work.type, 'journal-article');
  assert.equal(entry.work.year, 2024);
  assert.throws(() =>
    parseBibliography('<xml><records></xml>', 'endnote', 'bad.xml'),
  );
  assert.throws(() =>
    parseBibliography(
      '<!DOCTYPE xml [<!ENTITY ext SYSTEM "file:///secret">]><xml/>',
      'endnote',
      'bad.xml',
    ),
  );
});
void test('duplicate DOI matching is normalized; same title with distinct DOI is a warning, not a merge', () => {
  const entries = parseBibliography(
    '@article{a,title={Same},doi={10.1234/ONE}}\n@article{b,title={Same},doi={https://doi.org/10.1234/ONE}}\n@article{c,title={Same},doi={10.1234/TWO}}',
    'bibtex',
    'test.bib',
  );
  const checked = checkBibliographyDuplicates(entries, []);
  assert.equal(checked[0].duplicate, '');
  assert.ok(checked[1].duplicate);
  assert.equal(checked[2].duplicate, '');
  assert.ok(checked[2].warnings.some((w) => w.includes('同标题')));
  const existing = [
    { title: 'Existing', metadata: { doi: 'https://doi.org/10.1234/ONE' } },
  ] as Paper[];
  assert.ok(checkBibliographyDuplicates(entries, existing)[0].duplicate);
});
void test('missing title and invalid identifiers cannot turn into fabricated valid metadata', () => {
  const [entry] = parseBibliography(
    'TY  - GEN\nDO  - not-a-doi\nER  -',
    'ris',
    'test.ris',
  );
  assert.ok(entry.error);
  assert.equal(entry.work.doi, '');
  assert.equal(entry.work.year, null);
  assert.throws(() =>
    parseBibliography('https://example.com/remote.bib', 'bibtex', 'test.bib'),
  );
  assert.throws(() =>
    parseBibliography('x'.repeat(500001), 'bibtex', 'test.bib'),
  );
});
void test('exports can be imported again with title, literal authors, DOI and abstract preserved', () => {
  const work: ScholarlyWork = {
    doi: '10.1234/test',
    title: 'Graph {A} & 研发',
    authors: ['Research and Development', 'Doe, Jane'],
    year: 2024,
    source: 'Test Journal',
    type: 'journal-article',
    abstract: 'x < 2 and y > 3',
    references: [],
    provider: 'RIS',
    retrievedAt: '',
    query: '',
  };
  for (const format of ['bibtex', 'ris', 'endnote'] as const) {
    const [entry] = parseBibliography(
      exportReferences([work], format),
      format,
      'roundtrip',
    );
    for (const key of ['title', 'authors', 'doi', 'year', 'abstract'] as const)
      assert.deepEqual(entry.work[key], work[key], `${format}:${key}`);
  }
});
