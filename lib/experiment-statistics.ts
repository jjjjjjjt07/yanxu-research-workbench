import { validateRows, type DataRow } from './domain.ts';
import { sha256 } from './graph.ts';

export type StatisticsGroup = {
  method: string;
  dataset: string;
  metric: string;
  indices: number[];
  runIds: (string | null)[];
  n: number;
  mean: number | null;
  sampleSD: number | null;
  min: number;
  max: number;
  issue: 'single_value' | 'numeric_range' | null;
};
export type ExperimentStatistics = {
  algorithm: 'descriptive-scaled-v1';
  computedAt: string;
  inputDataHash: string;
  grouping: ['method', 'dataset', 'metric'];
  countUnit: 'imported_run_records';
  meanFormula: 'sum(x) / n';
  sdFormula: 'sqrt(sum((x - mean)^2) / (n - 1))';
  groups: StatisticsGroup[];
};
// Compensated sums on scaled inputs avoid squaring large unscaled values.
function sum(values: number[]) {
  let total = 0,
    correction = 0;
  for (const value of values) {
    const next = total + value;
    correction +=
      Math.abs(total) >= Math.abs(value)
        ? total - next + value
        : value - next + total;
    total = next;
  }
  return total + correction;
}
export function summarizeExperiment(rows: DataRow[]): StatisticsGroup[] {
  validateRows(rows);
  const grouped = new Map<string, number[]>();
  rows.forEach((r, i) => {
    const key = JSON.stringify([r.method, r.dataset, r.metric]);
    const indices = grouped.get(key) ?? [];
    indices.push(i);
    grouped.set(key, indices);
  });
  return [...grouped.values()].map((indices) => {
    const first = rows[indices[0]],
      values = indices.map((i) => rows[i].value);
    const n = values.length,
      magnitude = Math.max(...values.map(Math.abs));
    const shifted = values.map((v) => v - values[0]);
    const useShift = shifted.every(Number.isFinite),
      working = useShift ? shifted : values;
    const scale = Math.max(...working.map(Math.abs));
    const scaled = working.map((v) => (scale ? v / scale : 0));
    const center = sum(scaled) / n;
    let mean = (useShift ? values[0] : 0) + center * scale;
    // Avoid subtracting two large nearly equal numbers for a near-zero mean.
    if (Math.abs(mean) < magnitude / 2)
      mean = (sum(values.map((v) => v / magnitude)) / n) * magnitude;
    const sd =
      n > 1
        ? Math.sqrt(sum(scaled.map((v) => (v - center) ** 2)) / (n - 1)) * scale
        : null;
    const invalid =
      !Number.isFinite(mean) || (sd !== null && !Number.isFinite(sd));
    return {
      method: first.method,
      dataset: first.dataset,
      metric: first.metric,
      indices,
      runIds: indices.map((i) => rows[i].runId ?? null),
      n,
      mean: Number.isFinite(mean) ? mean : null,
      sampleSD: sd !== null && Number.isFinite(sd) ? sd : null,
      min: Math.min(...values),
      max: Math.max(...values),
      issue: invalid ? 'numeric_range' : n === 1 ? 'single_value' : null,
    };
  });
}
export async function buildExperimentStatistics(
  rows: DataRow[],
): Promise<ExperimentStatistics> {
  return {
    algorithm: 'descriptive-scaled-v1',
    computedAt: new Date().toISOString(),
    inputDataHash: await sha256(JSON.stringify(rows)),
    grouping: ['method', 'dataset', 'metric'],
    countUnit: 'imported_run_records',
    meanFormula: 'sum(x) / n',
    sdFormula: 'sqrt(sum((x - mean)^2) / (n - 1))',
    groups: summarizeExperiment(rows),
  };
}
