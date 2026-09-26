import Papa from 'papaparse';
import { validateRows, type DataRow } from './domain.ts';
import { sha256 } from './graph.ts';

export type CsvSource = {
  id: string;
  filename: string;
  origin: 'file' | 'text';
  sha256: string;
  size: number;
  encoding: 'utf-8';
  parser: 'papaparse-5.7.0/comma-v1' | 'papaparse-5.7.0/comma-runs-v2';
  at: string;
  actor: string;
  lineRanges: [number, number][];
};
export function serializeExperimentCsv(rows: DataRow[]) {
  return Papa.unparse(
    {
      fields: [
        'method',
        'dataset',
        'metric',
        'value',
        ...(rows.some((r) => r.runId !== undefined) ? ['runId'] : []),
      ],
      data: rows,
    },
    { escapeFormulae: true },
  );
}
export function encodeCsvBytes(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
export function decodeCsvBytes(base64: string) {
  if (
    !base64 ||
    base64.length > 1_333_336 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      base64,
    )
  )
    throw new Error('CSV文件编码无效或超过1MB。');
  const binary = atob(base64);
  if (binary.length > 1_000_000) throw new Error('CSV请控制在1MB内。');
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
export function parseExperimentCsv(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > 1_000_000)
    throw new Error('CSV需要非空且不超过1MB。');
  let text: string;
  try {
    // Papa also strips a leading BOM; normalize it here so its cursor offsets
    // refer to exactly the same text used for physical line tracking.
    text = new TextDecoder('utf-8', { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF+/, '');
  } catch {
    throw new Error('CSV不是有效的UTF-8文件，请转换编码后重试。');
  }
  if (text.includes('\0')) throw new Error('CSV包含无效的空字符。');
  const rows: DataRow[] = [],
    lineRanges: [number, number][] = [];
  let headers: string[] | undefined,
    cursor = 0,
    line = 1;
  Papa.parse<string[]>(text, {
    delimiter: ',',
    skipEmptyLines: false,
    step(result) {
      if (result.errors.length)
        throw new Error('CSV格式不正确：' + result.errors[0].message);
      const segment = text.slice(cursor, result.meta.cursor);
      const startLine = line;
      const breaks = segment.match(/\r\n|\r|\n/g)?.length ?? 0;
      line += breaks;
      const endLine = line - (/\r\n$|[\r\n]$/.test(segment) ? 1 : 0);
      cursor = result.meta.cursor;
      const cells = result.data;
      if (cells.every((c) => !c.trim())) return;
      if (!headers) {
        headers = cells.map((c) => c.trim());
        if (
          headers.some((h) => !h) ||
          new Set(headers).size !== headers.length ||
          ['method', 'dataset', 'metric', 'value'].some(
            (h) => !headers!.includes(h),
          )
        )
          throw new Error(
            'CSV须包含唯一的method、dataset、metric、value列名，其他列也不能重名或留空。',
          );
        return;
      }
      if (cells.length !== headers.length)
        throw new Error(`CSV第${startLine}行的列数与表头不一致。`);
      const get = (key: string) => cells[headers!.indexOf(key)].trim();
      rows.push({
        method: get('method'),
        dataset: get('dataset'),
        metric: get('metric'),
        value: get('value') === '' ? NaN : Number(get('value')),
        ...(headers.includes('runId') && get('runId')
          ? { runId: get('runId') }
          : {}),
      });
      lineRanges.push([startLine, endLine]);
      if (rows.length > 2000) throw new Error('实验数据最多2000行。');
    },
  });
  validateRows(rows);
  return { rows, lineRanges };
}
export async function captureCsvSource(
  bytes: Uint8Array,
  filename: string,
  origin: CsvSource['origin'],
  actor: string,
) {
  const parsed = parseExperimentCsv(bytes);
  const source: CsvSource = {
    id: crypto.randomUUID(),
    filename,
    origin,
    sha256: await sha256(bytes.slice().buffer),
    size: bytes.length,
    encoding: 'utf-8',
    parser: 'papaparse-5.7.0/comma-runs-v2',
    at: new Date().toISOString(),
    actor,
    lineRanges: parsed.lineRanges,
  };
  return { rows: parsed.rows, source };
}
export function csvSourceSummary(source: CsvSource) {
  const { lineRanges: _ranges, ...summary } = source;
  return structuredClone(summary);
}
export function csvRowReference(source: CsvSource, index: number) {
  const range = source.lineRanges[index];
  if (!range) throw new Error('CSV来源行记录缺失。');
  return {
    id: `${source.id}:${index + 1}`,
    startLine: range[0],
    endLine: range[1],
  };
}
