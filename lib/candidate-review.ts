import {
  cellSnapshot,
  now,
  uid,
  type Cell,
  type CellValue,
  type ProjectState,
} from './domain.ts';

export const differenceNames = {
  same: '内容相同',
  format: '仅排版变化',
  unit: '单位换算等价',
  number: '数值变化',
  text: '文字或条件变化',
};
const spaces = (text: string) => text.trim().replace(/\s+/g, ' ');
// Only standalone quantities in an explicit small unit dictionary are comparable.
const units: Record<string, [string, number]> = {
  us: ['time', 1],
  µs: ['time', 1],
  μs: ['time', 1],
  ms: ['time', 1000],
  s: ['time', 1000000],
  min: ['time', 60000000],
  h: ['time', 3600000000],
  um: ['length', 1],
  µm: ['length', 1],
  μm: ['length', 1],
  mm: ['length', 1000],
  cm: ['length', 10000],
  m: ['length', 1000000],
  km: ['length', 1000000000],
  mg: ['mass', 1],
  g: ['mass', 1000],
  kg: ['mass', 1000000],
};
function quantity(text: string) {
  const match =
    /^([+-]?\d{1,30})(?:\.(\d{1,12}))?\s*(us|µs|μs|ms|s|min|h|um|µm|μm|mm|cm|m|km|mg|g|kg)$/.exec(
      text.trim(),
    );
  if (!match) return null;
  const [dimension, scale] = units[match[3]],
    fraction = match[2] ?? '';
  const negative = match[1].startsWith('-');
  const integer = match[1].replace(/^[+-]/, '');
  return {
    dimension,
    numerator:
      BigInt(integer + fraction) * BigInt(scale) * BigInt(negative ? -1 : 1),
    denominator: BigInt(10) ** BigInt(fraction.length),
  };
}
export function valueDifference(
  before: string,
  after: string,
): keyof typeof differenceNames {
  if (before === after) return 'same';
  if (spaces(before) === spaces(after)) return 'format';
  const a = quantity(before),
    b = quantity(after);
  if (
    a &&
    b &&
    a.dimension === b.dimension &&
    a.numerator * b.denominator === b.numerator * a.denominator
  )
    return 'unit';
  const numbers = (value: string) =>
    value.match(/[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? [];
  if (JSON.stringify(numbers(before)) !== JSON.stringify(numbers(after)))
    return 'number';
  return 'text';
}
export function candidateDifference(state: ProjectState, cell: Cell) {
  const candidate = cell.candidate;
  if (!candidate) return null;
  const kind = valueDifference(cell.value, candidate.value);
  const field = state.fields.find((f) => f.id === cell.fieldId);
  const rule =
    state.rules.filter((r) => r.fieldId === cell.fieldId).at(-1)?.version ?? 0;
  const sourceChanged =
    cell.blockId !== candidate.blockId ||
    cell.quote !== candidate.quote ||
    cell.page !== candidate.page ||
    cell.evidenceRef?.id !== candidate.evidenceRef?.id ||
    cell.evidenceRef?.documentHash !== candidate.evidenceRef?.documentHash ||
    cell.evidenceRef?.parseHash !== candidate.evidenceRef?.parseHash;
  const noteChanged = cell.note !== candidate.note;
  const warnings: string[] = [];
  if (!candidate.value.trim() || !candidate.sourceValid)
    warnings.push('候选缺少有效原文依据或值');
  if (
    !field ||
    candidate.fieldVersion !== field.version ||
    candidate.ruleVersion !== rule
  )
    warnings.push('候选对应旧字段或规则');
  if (cell.status !== 'confirmed' || !cell.sourceValid)
    warnings.push('当前值尚未完成有效来源核对');
  if (
    cell.fieldVersion !== candidate.fieldVersion ||
    cell.ruleVersion !== candidate.ruleVersion
  )
    warnings.push('新旧提取口径不同');
  if (candidate.origin === 'sample' || cell.origin === 'sample')
    warnings.push('包含虚构演示结果');
  return {
    kind,
    sourceChanged,
    noteChanged,
    warnings,
    batchAcceptable:
      ['same', 'format'].includes(kind) &&
      !sourceChanged &&
      !noteChanged &&
      !warnings.length,
  };
}
export function textDifference(before: string, after: string) {
  const a = Array.from(before),
    b = Array.from(after);
  let start = 0,
    end = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  while (
    end < a.length - start &&
    end < b.length - start &&
    a[a.length - end - 1] === b[b.length - end - 1]
  )
    end++;
  return {
    prefix: a.slice(0, start).join(''),
    removed: a.slice(start, a.length - end).join(''),
    added: b.slice(start, b.length - end).join(''),
    suffix: end ? a.slice(-end).join('') : '',
  };
}
export type CandidateDecision = {
  id: string;
  cellId: string;
  paperId: string;
  fieldId: string;
  at: string;
  actor: string;
  decision: 'accept' | 'retain' | 'manual';
  reason: string;
  batchId?: string;
  before: CellValue;
  candidate: CellValue;
  after: CellValue;
  beforeStatus: string;
  afterStatus: string;
};
export function recordCandidateDecision(
  state: ProjectState,
  cell: Cell,
  before: CellValue,
  candidate: CellValue,
  beforeStatus: string,
  decision: CandidateDecision['decision'],
  actor: string,
  reason: string,
  batchId?: string,
) {
  (state.candidateReviews ??= []).push({
    id: uid(),
    cellId: cell.id,
    paperId: cell.paperId,
    fieldId: cell.fieldId,
    at: now(),
    actor,
    decision,
    reason,
    batchId,
    before,
    candidate,
    after: cellSnapshot(cell),
    beforeStatus,
    afterStatus: cell.status,
  });
}
export function applyCandidateDecision(
  state: ProjectState,
  cell: Cell,
  decision: 'accept' | 'retain',
  actor: string,
  reason: string,
  batchId?: string,
) {
  if (!cell.candidate) throw new Error('候选已不存在，请刷新预览。');
  const before = cellSnapshot(cell),
    candidate = cellSnapshot(cell.candidate),
    beforeStatus = cell.status;
  if (decision === 'accept') {
    cell.history.push({
      at: now(),
      value: before,
      status: cell.status,
      reason,
    });
    Object.assign(cell, candidate, { status: 'confirmed' });
  }
  delete cell.candidate;
  recordCandidateDecision(
    state,
    cell,
    before,
    candidate,
    beforeStatus,
    decision,
    actor,
    reason,
    batchId,
  );
}
