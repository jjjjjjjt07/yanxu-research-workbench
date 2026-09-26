import { z } from 'zod';
import distribution from 'jstat';
import type { Experiment } from './domain';
import { buildExperimentStatistics } from './experiment-statistics.ts';
export const intervalAssumptionsSchema = z.object({
  unit: z.string().trim().min(1).max(120),
  samplingUnit: z.string().trim().min(1).max(500),
  conditions: z.string().trim().min(1).max(2000),
  independent: z.literal(true),
  independenceBasis: z.string().trim().min(1).max(1500),
  approximateNormal: z.literal(true),
  distributionBasis: z.string().trim().min(1).max(1500),
});
export type IntervalAssumptions = z.infer<typeof intervalAssumptionsSchema>;
export type MeanInterval = {
  id: string;
  experimentId: string;
  versionId: string;
  method: string;
  dataset: string;
  metric: string;
  assumptions: IntervalAssumptions;
  reason: string;
  actor: string;
  at: string;
  algorithm: 'student-t-mean-95/jstat-1.9.6/v1';
  inputDataHash: string;
  indices: number[];
  runIds: string[];
  n: number;
  mean: number;
  sampleSD: number;
  confidence: 0.95;
  df: number;
  critical: number;
  standardError: number;
  margin: number;
  lower: number;
  upper: number;
  formula: 'mean ± t(0.975, n-1) * sampleSD / sqrt(n)';
};
export async function calculateMeanInterval(
  experiment: Experiment,
  versionId: string,
  group: { method: string; dataset: string; metric: string },
  assumptions: IntervalAssumptions,
  actor: string,
  reason: string,
): Promise<MeanInterval> {
  const version = experiment.versions.at(-1);
  if (!version || version.id !== versionId)
    throw new Error('实验版本已变化，请重新选择当前数据。');
  const checked = intervalAssumptionsSchema.parse(assumptions);
  if (!reason.trim()) throw new Error('请填写本次计算说明。');
  const statistics = await buildExperimentStatistics(version.rows);
  const values = statistics.groups.find(
    (g) =>
      g.method === group.method &&
      g.dataset === group.dataset &&
      g.metric === group.metric,
  );
  if (!values) throw new Error('指定数据分组不存在。');
  if (values.n < 2 || values.runIds.some((id) => !id))
    throw new Error('至少需要两条有不同运行编号的记录。');
  if (values.issue || values.mean === null || values.sampleSD === null)
    throw new Error('基础统计无法可靠计算，未生成置信区间。');
  if (values.sampleSD === 0)
    throw new Error(
      '记录没有变化，无法据此评估均值的不确定性；请核对测量分辨率与重复运行记录。',
    );
  const df = values.n - 1,
    critical = distribution.jStat.studentt.inv(0.975, df);
  const standardError = values.sampleSD / Math.sqrt(values.n),
    margin = critical * standardError;
  const lower = values.mean - margin,
    upper = values.mean + margin;
  if (
    ![critical, standardError, margin, lower, upper].every(Number.isFinite) ||
    standardError < 2 ** -1022 ||
    margin <= 0 ||
    lower >= values.mean ||
    upper <= values.mean
  )
    throw new Error('数值超出区间计算的范围或精度，本次未保存。');
  return {
    id: crypto.randomUUID(),
    experimentId: experiment.id,
    versionId,
    ...group,
    assumptions: checked,
    actor,
    reason: reason.trim(),
    at: new Date().toISOString(),
    algorithm: 'student-t-mean-95/jstat-1.9.6/v1',
    inputDataHash: statistics.inputDataHash,
    indices: values.indices,
    runIds: values.runIds as string[],
    n: values.n,
    mean: values.mean,
    sampleSD: values.sampleSD,
    confidence: 0.95,
    df,
    critical,
    standardError,
    margin,
    lower,
    upper,
    formula: 'mean ± t(0.975, n-1) * sampleSD / sqrt(n)',
  };
}
