import { z } from 'zod';
import distribution from 'jstat';
import type { Experiment } from './domain';
import {
  buildExperimentStatistics,
  summarizeExperiment,
  type StatisticsGroup,
} from './experiment-statistics.ts';
export const comparisonAssumptionsSchema = z.object({
  unit: z.string().trim().min(1).max(120),
  samplingUnit: z.string().trim().min(1).max(500),
  conditions: z.string().trim().min(1).max(2000),
  independent: z.literal(true),
  independenceBasis: z.string().trim().min(1).max(1500),
  approximateNormal: z.literal(true),
  distributionBasis: z.string().trim().min(1).max(1500),
  pairingBasis: z.string().trim().max(1500).default(''),
  pairingConfirmed: z.boolean().default(false),
});
export const multiplicitySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('single'),
    count: z.literal(1),
    plan: z.string().trim().min(1).max(2000),
    confirmed: z.literal(true),
  }),
  z.object({
    kind: z.literal('bonferroni'),
    count: z.number().int().min(2).max(100),
    plan: z.string().trim().min(1).max(2000),
    confirmed: z.literal(true),
  }),
]);
export type ComparisonAssumptions = z.infer<typeof comparisonAssumptionsSchema>;
export type Multiplicity = z.infer<typeof multiplicitySchema>;
export type ComparisonDesign = 'welch' | 'paired';
type Sample = {
  method: string;
  n: number;
  mean: number;
  sampleSD: number;
  indices: number[];
  runIds: string[];
};
export type ExperimentComparison = {
  id: string;
  experimentId: string;
  versionId: string;
  dataset: string;
  metric: string;
  design: ComparisonDesign;
  assumptions: ComparisonAssumptions;
  multiplicity: Multiplicity;
  actor: string;
  at: string;
  reason: string;
  algorithm: 'two-sided-t/jstat-1.9.6/v1';
  inputDataHash: string;
  sampleA: Sample;
  sampleB: Sample;
  pairs?: {
    runId: string;
    indexA: number;
    indexB: number;
    difference: number;
  }[];
  differenceSD?: number;
  effect: {
    kind: 'unstandardized-mean-difference';
    direction: 'A-B';
    value: number;
    unit: string;
  };
  standardError: number;
  df: number;
  t: number;
  rawP: number;
  adjustedP: number;
  familyAlpha: 0.05;
  comparisonAlpha: number;
  critical: number;
  lower: number;
  upper: number;
  rejectNull: boolean;
  nullDifference: 0;
  alternative: 'two-sided';
  formula: string;
};
export function twoSidedTP(t: number, df: number) {
  if (!Number.isFinite(t) || !Number.isFinite(df) || df <= 0)
    throw new Error('t统计量或自由度超出计算范围。');
  // Direct beta-form tail avoids the cancellation in 1-CDF(t) and jStat's
  // negative-tail expression when t is large. Refuse underflow rather than report p=0.
  const ratio = Math.abs(t) / Math.sqrt(df),
    x = 1 / (1 + ratio * ratio);
  const p = distribution.jStat.ibeta(x, df / 2, 0.5);
  if (!(p > 0 && p <= 1) || !Number.isFinite(p))
    throw new Error('尾概率超出计算精度，本次未保存推断结果。');
  return p;
}
function sample(g: StatisticsGroup | undefined): Sample {
  if (
    !g ||
    g.n < 2 ||
    g.mean === null ||
    g.sampleSD === null ||
    g.issue ||
    g.runIds.some((r) => !r)
  )
    throw new Error('每组至少需要两条有唯一运行编号且基础统计有效的记录。');
  return {
    method: g.method,
    n: g.n,
    mean: g.mean,
    sampleSD: g.sampleSD,
    indices: g.indices,
    runIds: g.runIds as string[],
  };
}
export async function calculateComparison(
  experiment: Experiment,
  versionId: string,
  selection: {
    methodA: string;
    methodB: string;
    dataset: string;
    metric: string;
    design: ComparisonDesign;
  },
  assumptions: ComparisonAssumptions,
  multiplicity: Multiplicity,
  actor: string,
  reason: string,
): Promise<ExperimentComparison> {
  const version = experiment.versions.at(-1);
  if (!version || version.id !== versionId)
    throw new Error('实验版本已变化，请重新选择当前数据。');
  if (selection.design !== 'welch' && selection.design !== 'paired')
    throw new Error('请选择独立或配对设计。');
  if (selection.methodA === selection.methodB)
    throw new Error('请选择两个不同的方法。');
  const checked = comparisonAssumptionsSchema.parse(assumptions),
    plan = multiplicitySchema.parse(multiplicity);
  if (!reason.trim()) throw new Error('请填写本次比较说明。');
  if (
    selection.design === 'paired' &&
    (!checked.pairingConfirmed || !checked.pairingBasis)
  )
    throw new Error('配对比较需要明确确认运行编号的对应关系并填写依据。');
  if (
    selection.design === 'welch' &&
    (checked.pairingConfirmed || checked.pairingBasis)
  )
    throw new Error('独立设计不能同时声明配对关系，请核对选择。');
  const stats = await buildExperimentStatistics(version.rows);
  const find = (method: string) =>
    stats.groups.find(
      (g) =>
        g.method === method &&
        g.dataset === selection.dataset &&
        g.metric === selection.metric,
    );
  const a = sample(find(selection.methodA)),
    b = sample(find(selection.methodB));
  let difference = a.mean - b.mean,
    standardError: number,
    df: number,
    differenceSD: number | undefined;
  let pairs: ExperimentComparison['pairs'];
  if (selection.design === 'paired') {
    const bByRun = new Map(b.runIds.map((runId, i) => [runId, b.indices[i]]));
    if (a.n !== b.n || a.runIds.some((id) => !bByRun.has(id)))
      throw new Error('配对运行编号必须完整一一对应，不能自动删除未匹配记录。');
    pairs = a.indices.map((indexA, i) => {
      const runId = a.runIds[i],
        indexB = bByRun.get(runId)!;
      return {
        runId,
        indexA,
        indexB,
        difference: version.rows[indexA].value - version.rows[indexB].value,
      };
    });
    if (pairs.some((p) => !Number.isFinite(p.difference)))
      throw new Error('配对差值超出数值范围。');
    const d = summarizeExperiment(
      pairs.map((p) => ({
        method: 'difference',
        dataset: selection.dataset,
        metric: selection.metric,
        runId: p.runId,
        value: p.difference,
      })),
    )[0];
    if (d.mean === null || d.sampleSD === null || d.issue)
      throw new Error('配对差值统计无法可靠计算。');
    difference = d.mean;
    differenceSD = d.sampleSD;
    standardError = d.sampleSD / Math.sqrt(d.n);
    df = d.n - 1;
  } else {
    const seA = a.sampleSD / Math.sqrt(a.n),
      seB = b.sampleSD / Math.sqrt(b.n);
    standardError = Math.hypot(seA, seB);
    const wa = (seA / standardError) ** 2,
      wb = (seB / standardError) ** 2;
    df = (wa + wb) ** 2 / ((wa * wa) / (a.n - 1) + (wb * wb) / (b.n - 1));
  }
  if (
    !Number.isFinite(difference) ||
    !Number.isFinite(standardError) ||
    standardError < 2 ** -1022 ||
    !Number.isFinite(df) ||
    df <= 0
  )
    throw new Error(
      '差值标准误为零或数值精度不足，未生成检验。请核对运行记录及测量分辨率。',
    );
  const t = difference / standardError,
    rawP = twoSidedTP(t, df),
    adjustedP = Math.min(1, rawP * plan.count);
  const comparisonAlpha = 0.05 / plan.count,
    critical = distribution.jStat.studentt.inv(1 - comparisonAlpha / 2, df);
  const margin = critical * standardError,
    lower = difference - margin,
    upper = difference + margin;
  if (
    ![critical, margin, lower, upper].every(Number.isFinite) ||
    lower >= difference ||
    upper <= difference
  )
    throw new Error('差值区间超出计算范围或精度，本次未保存。');
  return {
    id: crypto.randomUUID(),
    experimentId: experiment.id,
    versionId,
    dataset: selection.dataset,
    metric: selection.metric,
    design: selection.design,
    assumptions: checked,
    multiplicity: plan,
    actor,
    at: new Date().toISOString(),
    reason: reason.trim(),
    algorithm: 'two-sided-t/jstat-1.9.6/v1',
    inputDataHash: stats.inputDataHash,
    sampleA: a,
    sampleB: b,
    ...(pairs ? { pairs, differenceSD } : {}),
    effect: {
      kind: 'unstandardized-mean-difference',
      direction: 'A-B',
      value: difference,
      unit: checked.unit,
    },
    standardError,
    df,
    t,
    rawP,
    adjustedP,
    familyAlpha: 0.05,
    comparisonAlpha,
    critical,
    lower,
    upper,
    rejectNull: adjustedP < 0.05,
    nullDifference: 0,
    alternative: 'two-sided',
    formula:
      selection.design === 'welch'
        ? 'Welch: SE=hypot(sA/sqrt(nA),sB/sqrt(nB)); df=Welch-Satterthwaite; t=(meanA-meanB)/SE; CI=diff ± t(1-alpha/(2m),df)*SE'
        : 'Paired: d_i=A_i-B_i by runId; SE=SD(d)/sqrt(n); df=n-1; t=mean(d)/SE; CI=mean(d) ± t(1-alpha/(2m),df)*SE',
  };
}
