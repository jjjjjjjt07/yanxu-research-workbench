import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkedExtraction,
  graphExtractionSchema,
  emptyGraph,
  activeEntity,
  evidencePath,
  neighborhood,
  jobCounts,
  sha256,
  quoteExists,
  entityPaperIds,
  editEntityDetails,
  type Bridge,
  type Relation,
} from '../lib/graph.ts';
import {
  emptyState,
  type Paper,
  type Project,
  exportCSV,
} from '../lib/domain.ts';
import { selectMatrixPapers } from '../lib/matrix-scope.ts';
import { saveManuscript } from '../lib/manuscript.ts';
import { modelConfig } from '../lib/model-config.ts';
import {
  normalizeDOI,
  crossrefWork,
  exportReferences,
} from '../lib/scholar.ts';
const paper = { id: 'p1', hash: 'h1' } as Paper;
const blocks = [
  { id: 'b1', page: 2, text: 'Method A uses Dataset X under condition C.' },
];
function raw() {
  return graphExtractionSchema.parse({
    entities: [
      {
        key: 'a',
        name: 'Method A',
        type: 'method',
        domain: 'engineering',
        definition: 'A',
        mentions: [
          { blockId: 'b1', quote: blocks[0].text, surface: 'Method A' },
        ],
      },
      {
        key: 'x',
        name: 'Dataset X',
        type: 'data',
        domain: 'engineering',
        definition: 'X',
        mentions: [
          { blockId: 'b1', quote: blocks[0].text, surface: 'Dataset X' },
        ],
      },
    ],
    relations: [
      {
        source: 'a',
        target: 'x',
        type: 'uses',
        condition: 'C',
        evidence: [{ blockId: 'b1', quote: blocks[0].text }],
      },
    ],
  });
}
void test('graph rejects invented evidence and nonexistent entity mentions', () => {
  const r = raw();
  r.entities[0].mentions[0].surface = 'Invented method';
  const g = checkedExtraction(r, paper, blocks, 'parse', 'run');
  assert.equal(g.entities.length, 1);
  assert.equal(g.relations.length, 0);
  assert.equal(g.warnings.length, 2);
});
void test('real evidence existence never confirms model relationships', () => {
  const g = checkedExtraction(raw(), paper, blocks, 'parse', 'run');
  assert.equal(g.relations[0].status, 'candidate');
  assert.equal(g.relations[0].support, 'unknown');
  assert.equal(g.evidence[0].page, 2);
  assert.equal(g.evidence[0].parseHash, 'parse');
  assert.equal(g.evidence[0].documentHash, 'h1');
});
void test('same name in different papers remains separate until explicit merge', () => {
  const a = checkedExtraction(raw(), paper, blocks, 'p', 'r'),
    b = checkedExtraction(raw(), { ...paper, id: 'p2' }, blocks, 'p', 'r2');
  assert.notEqual(a.entities[0].id, b.entities[0].id);
});
void test('semantic conflict is preserved without discarding valid source text', () => {
  const g = checkedExtraction(raw(), paper, blocks, 'p', 'r', [
    { index: 0, support: 'conflict', reason: 'Direction is reversed' },
  ]);
  assert.equal(g.relations[0].support, 'conflict');
  assert.equal(g.evidence.length, 1);
  assert.equal(g.relations[0].status, 'candidate');
});
void test('structurally incompatible comparisons cannot inherit model support', () => {
  const r = raw();
  r.relations[0].type = 'compares';
  const g = checkedExtraction(r, paper, blocks, 'p', 'r', [
    { index: 0, support: 'supported', reason: 'Incorrect model approval' },
  ]);
  assert.equal(g.relations[0].support, 'unknown');
  assert.equal(g.relations[0].status, 'candidate');
  assert.match(g.relations[0].reason, /端点类型不一致/);
  assert.equal(g.evidence.length, 1);
});
void test('duplicate extraction keys are rejected instead of rewiring relations', () => {
  const r = raw();
  r.entities[1].key = 'a';
  assert.throws(
    () => checkedExtraction(r, paper, blocks, 'p', 'r'),
    /重复实体/,
  );
});
void test('bounded directed paths exclude unreviewed and hypothetical relationships', () => {
  const r = (
    source: string,
    target: string,
    status = 'confirmed',
    type = 'uses',
  ) =>
    ({
      source,
      target,
      status,
      type,
      support: 'supported',
      evidenceIds: ['e'],
    }) as Relation;
  const edges = [
    r('a', 'b'),
    r('b', 'c'),
    r('c', 'd', 'candidate'),
    r('c', 'e', 'confirmed', 'association'),
  ];
  assert.equal(evidencePath(edges, 'a', 'c')?.length, 2);
  assert.equal(evidencePath(edges, 'c', 'a'), null);
  assert.equal(evidencePath(edges, 'a', 'd'), null);
  assert.equal(evidencePath(edges, 'a', 'e'), null);
  assert.equal(evidencePath(edges, 'a', 'c', 1), null);
  assert.deepEqual([...neighborhood(edges, 'a', 1)], ['a', 'b']);
});
void test('finished count is not successful count', () => {
  assert.deepEqual(
    jobCounts([
      { status: 'succeeded' },
      { status: 'succeeded' },
      { status: 'failed' },
    ]),
    {
      total: 3,
      ended: 3,
      succeeded: 2,
      partial: 0,
      failed: 1,
      cancelled: 0,
      running: 0,
      queued: 0,
    },
  );
});
void test('merge indirection preserves original endpoints and can be undone', () => {
  const g = emptyGraph();
  g.entities = checkedExtraction(raw(), paper, blocks, 'p', 'r').entities;
  const [a, b] = g.entities;
  a.mergedInto = b.id;
  assert.equal(activeEntity(g, a.id), b.id);
  delete a.mergedInto;
  assert.equal(activeEntity(g, a.id), a.id);
  a.mergedInto = b.id;
  b.mergedInto = a.id;
  assert.throws(() => activeEntity(g, a.id), /循环/);
});
void test('source punctuation is not erased to manufacture quote matches', () => {
  assert.equal(
    quoteExists([{ id: 'b', page: 1, text: 'x = 10' }], {
      blockId: 'b',
      quote: 'x = 1.0',
    }),
    false,
  );
});
void test('entity corrections invalidate dependent reviews while preserving source evidence', () => {
  const g = {
    ...emptyGraph(),
    ...checkedExtraction(raw(), paper, blocks, 'p', 'r'),
  };
  const [a, b] = g.entities;
  const relation = g.relations[0];
  relation.status = 'confirmed';
  relation.support = 'supported';
  g.bridges = [
    {
      id: 'bridge',
      source: a.id,
      target: b.id,
      relationIds: [relation.id],
      status: 'explore',
    } as Bridge,
  ];
  const evidence = JSON.stringify(g.evidence);
  editEntityDetails(g, a.id, {
    name: a.name,
    aliases: a.aliases,
    type: a.type,
  });
  assert.equal(relation.status, 'confirmed', 'No-op edit must retain review');
  editEntityDetails(g, a.id, {
    type: 'concept',
    definition: 'Corrected scope',
  });
  assert.equal(relation.status, 'stale');
  assert.equal(relation.support, 'unknown');
  assert.equal(g.bridges[0].status, 'stale');
  assert.equal(JSON.stringify(g.evidence), evidence);
});
void test('merged node comparison includes all original papers and can be narrowed after undo', () => {
  const g = emptyGraph();
  const extracted = checkedExtraction(raw(), paper, blocks, 'p', 'r');
  const original = extracted.entities[0];
  const other = { ...original, id: 'other', paperIds: ['p2'] };
  g.entities = [original, other];
  original.mergedInto = other.id;
  assert.deepEqual(entityPaperIds(g, [other.id]).sort(), ['p1', 'p2']);
  delete original.mergedInto;
  assert.deepEqual(entityPaperIds(g, [other.id]), ['p2']);
});
void test('matrix scope, search and export never silently expand an empty selection', () => {
  const p = { state: emptyState() } as Project;
  p.state.papers = [
    { id: 'p1', title: 'Alpha', filename: 'alpha.txt' },
    { id: 'p2', title: 'Beta', filename: 'beta.txt' },
  ] as Paper[];
  assert.equal(selectMatrixPapers(p).length, 2);
  assert.equal(selectMatrixPapers(p, '', []).length, 0);
  assert.equal(selectMatrixPapers(p, 'Beta', ['p1']).length, 0);
  const papers = selectMatrixPapers(p, 'Alpha', ['p1', 'p2']);
  assert.deepEqual(
    papers.map((p) => p.id),
    ['p1'],
  );
  const csv = exportCSV({ ...p, state: { ...p.state, papers } });
  assert.match(csv, /Alpha/);
  assert.doesNotMatch(csv, /Beta/);
});
void test('first manuscript save creates v1, no-op saves retain version count', () => {
  const r = emptyState().review;
  assert.equal(
    saveManuscript(r, { oldText: 'A', newText: 'B', feedback: 'C' }, 'user'),
    true,
  );
  assert.equal(r.versions?.[0].number, 1);
  assert.equal(
    saveManuscript(r, { oldText: 'A', newText: 'B', feedback: 'C' }, 'user'),
    false,
  );
  assert.equal(r.versions?.length, 1);
});
void test('more than ten manuscript versions survive and restoring appends', () => {
  const r = emptyState().review;
  for (let i = 0; i < 13; i++)
    saveManuscript(
      r,
      { oldText: 'A', newText: `B${i}`, feedback: 'C' },
      'user',
    );
  assert.equal(r.versions?.length, 13);
  assert.equal(r.history.length, 12);
  const v = r.versions![0];
  saveManuscript(r, v, 'user', v.id);
  assert.equal(r.versions?.length, 14);
  assert.equal(r.versions?.at(-1)?.restoredFrom, v.id);
});
void test('legacy manuscript baseline has unknown historical author and time', () => {
  const r = emptyState().review;
  r.newText = 'legacy';
  saveManuscript(r, { oldText: '', newText: 'new', feedback: '' }, 'user');
  assert.equal(r.versions?.[0].at, null);
  assert.equal(r.versions?.[0].author, '未知');
  assert.equal(r.versions?.[1].number, 2);
});
void test('DeepSeek V4.1 Flash defaults are real configuration without exposing keys', () => {
  const c = modelConfig({ AI_API_KEY: 'test-secret' });
  assert.equal(c.model, 'deepseek-flash');
  assert.equal(c.baseUrl, 'https://api.deepseek.com');
  assert.equal(JSON.stringify(c).includes('test-secret'), false);
});
void test('bibliographic imports preserve missing data and exact DOI identity', () => {
  assert.equal(normalizeDOI('https://doi.org/10.1000/ABC'), '10.1000/abc');
  const w = crossrefWork(
    { DOI: '10.1000/ABC', title: ['Title'], type: 'posted-content' },
    'query',
  );
  assert.equal(w.year, null);
  assert.equal(w.abstract, '');
  assert.equal(w.type, 'posted-content');
  assert.match(exportReferences([w], 'ris'), /TY  - GEN/);
});
void test('export digest is SHA-256 over exact bytes', async () => {
  assert.equal(
    await sha256('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});
