import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  captureCsvSource,
  decodeCsvBytes,
  encodeCsvBytes,
  parseExperimentCsv,
} from '../lib/experiment-csv.ts';
import { captureExperiment } from '../lib/observations.ts';
import {
  saveReproducibility,
  reproducibilitySchema,
} from '../lib/experiment-reproducibility.ts';
import type { Experiment } from '../lib/domain';
const bytes = (s: string) => new TextEncoder().encode(s);
const header = 'method,dataset,metric,value';

void test('CSV byte identity and physical lines survive BOM, blank records, quoted commas and multiline fields', async () => {
  const raw = bytes(
    '\uFEFF' +
      header +
      ',comment\r\n\r\n"A, one",X,accuracy,0,"note\r\nwith ""quotes"""\r\n,,, ,\r\nB,X,accuracy,90,extra\r\n',
  );
  assert.deepEqual(decodeCsvBytes(encodeCsvBytes(raw)), raw);
  const { rows, source } = await captureCsvSource(
    raw,
    '数据.csv',
    'file',
    'tester',
  );
  assert.deepEqual(rows, [
    { method: 'A, one', dataset: 'X', metric: 'accuracy', value: 0 },
    { method: 'B', dataset: 'X', metric: 'accuracy', value: 90 },
  ]);
  assert.deepEqual(source.lineRanges, [
    [3, 4],
    [6, 6],
  ]);
  assert.equal(source.sha256, createHash('sha256').update(raw).digest('hex'));
  assert.equal(source.size, raw.length);
  assert.deepEqual(
    parseExperimentCsv(bytes('\uFEFF\uFEFF' + header + '\nA,X,m,1')).lineRanges,
    [[2, 2]],
  );
  assert.equal(
    decodeCsvBytes(encodeCsvBytes(new Uint8Array(1_000_000))).length,
    1_000_000,
  );
  for (const separator of ['\n', '\r', '\r\n']) {
    const parsed = parseExperimentCsv(
      bytes(header + separator + 'A,X,m,1' + separator + separator + 'B,X,m,2'),
    );
    assert.deepEqual(parsed.lineRanges, [
      [2, 2],
      [4, 4],
    ]);
  }
});
void test('CSV rejects ambiguous headers, malformed quotes, invalid numbers/encoding, repeated data and size limits', () => {
  for (const text of [
    'method,dataset,metric,value,value\nA,X,m,1,2',
    'method,dataset,metric,\nA,X,m,1',
    header + '\nA,X,m,',
    header + '\nA,X,m,Infinity',
    header + '\nA,X,m,1,extra',
    header + '\n"A,X,m,1',
    header + '\nA,X,m,1\nA,X,m,2',
    header + '\nA,X,m,1\0',
    header +
      '\n' +
      Array.from({ length: 2001 }, (_, i) => `A${i},X,m,1`).join('\n'),
  ])
    assert.throws(() => parseExperimentCsv(bytes(text)));
  assert.throws(() => parseExperimentCsv(new Uint8Array([255, 254, 0, 65])));
  assert.throws(() => parseExperimentCsv(new Uint8Array(1_000_001)));
  assert.throws(() => decodeCsvBytes('!not-base64'));
  assert.throws(() =>
    decodeCsvBytes(encodeCsvBytes(new Uint8Array(1_000_001))),
  );
});
void test('reproducibility-only versions preserve CSV identity and observations capture only selected original rows', async () => {
  const { rows, source } = await captureCsvSource(
    bytes(header + '\nA,X,m,1\n\nB,X,m,2'),
    'paste.csv',
    'text',
    'tester',
  );
  const experiment: Experiment = {
    id: 'e',
    name: 'test',
    direction: 'higher',
    versions: [
      { id: 'v1', at: 'then', filename: 'paste.csv', rows, csvSource: source },
    ],
  };
  const original = structuredClone(experiment.versions[0]);
  const v2 = await saveReproducibility(
    experiment,
    'v1',
    reproducibilitySchema.parse({ randomSeed: '42' }),
    'tester',
    'record seed',
  );
  assert.deepEqual(v2.csvSource, source);
  assert.notEqual(v2.csvSource, source);
  assert.deepEqual(experiment.versions[0], original);
  const snapshot = await captureExperiment(experiment, v2.id, [1]);
  assert.equal(snapshot.csvSource?.sha256, source.sha256);
  assert.equal('lineRanges' in snapshot.csvSource!, false);
  assert.deepEqual(snapshot.rows[0].sourceRow, {
    id: source.id + ':2',
    startLine: 4,
    endLine: 4,
  });
  assert.equal(snapshot.rows[0].value.value, 2);
});
