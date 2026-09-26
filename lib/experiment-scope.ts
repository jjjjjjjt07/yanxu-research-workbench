import { z } from 'zod';
import type { DataRow, Experiment } from './domain.ts';

export const experimentScopeSchema = z
  .object({
    dataset: z.string().trim().min(1).max(150),
    metric: z.string().trim().min(1).max(150),
    unit: z.string().trim().min(1).max(120),
    samplingUnit: z.string().trim().min(1).max(500),
    conditions: z.string().trim().min(1).max(2000),
  })
  .strict();

export const experimentScopesSchema = z
  .array(experimentScopeSchema)
  .min(1)
  .max(100);

export type ExperimentScope = z.infer<typeof experimentScopeSchema>;
export type ExperimentScopeRecord = {
  values: ExperimentScope[];
  actor: string;
  at: string;
  reason: string;
  sourceVersionId: string;
};

const key = (dataset: string, metric: string) =>
  JSON.stringify([dataset, metric]);

export function experimentScopeKeys(rows: DataRow[]) {
  return [
    ...new Map(
      rows.map((row) => [
        key(row.dataset, row.metric),
        { dataset: row.dataset, metric: row.metric },
      ]),
    ).values(),
  ];
}

export function findExperimentScope(
  record: ExperimentScopeRecord | undefined,
  dataset: string,
  metric: string,
) {
  return record?.values.find(
    (value) => value.dataset === dataset && value.metric === metric,
  );
}

function checkedScopes(rows: DataRow[], input: ExperimentScope[]) {
  const values = experimentScopesSchema.parse(input);
  const expected = experimentScopeKeys(rows).map((value) =>
    key(value.dataset, value.metric),
  );
  const received = values.map((value) => key(value.dataset, value.metric));
  if (new Set(received).size !== received.length)
    throw new Error('同一数据集和指标只能保存一份单位与实验条件。');
  if (
    expected.length !== received.length ||
    expected.some((value) => !received.includes(value))
  )
    throw new Error('单位与实验条件必须完整覆盖当前数据中的每个数据集和指标。');
  return values;
}

export async function saveExperimentScopes(
  experiment: Experiment,
  versionId: string,
  input: ExperimentScope[],
  actor: string,
  reason: string,
) {
  const prior = experiment.versions.at(-1);
  if (!prior || prior.id !== versionId)
    throw new Error('实验版本已变化，请重新核对。');
  if (!reason.trim()) throw new Error('请填写单位与实验条件的核对说明。');
  if (experiment.versions.length >= 10)
    throw new Error('当前每个实验最多10个版本；旧版本未覆盖。');
  const values = checkedScopes(prior.rows, input);
  const at = new Date().toISOString();
  const version = {
    id: crypto.randomUUID(),
    at,
    filename: prior.filename,
    rows: structuredClone(prior.rows),
    ...(prior.statistics
      ? { statistics: structuredClone(prior.statistics) }
      : {}),
    ...(prior.csvSource ? { csvSource: structuredClone(prior.csvSource) } : {}),
    ...(prior.reproducibility
      ? { reproducibility: structuredClone(prior.reproducibility) }
      : {}),
    scope: {
      values,
      actor,
      at,
      reason: reason.trim(),
      sourceVersionId: prior.id,
    },
  };
  experiment.versions.push(version);
  return version;
}

export function assertScopeMatches(
  experiment: Experiment,
  versionId: string,
  dataset: string,
  metric: string,
  assumptions: { unit: string; samplingUnit: string; conditions: string },
) {
  const version = experiment.versions.find((value) => value.id === versionId);
  const scope = findExperimentScope(version?.scope, dataset, metric);
  if (
    scope &&
    (scope.unit !== assumptions.unit.trim() ||
      scope.samplingUnit !== assumptions.samplingUnit.trim() ||
      scope.conditions !== assumptions.conditions.trim())
  )
    throw new Error(
      '计算使用的单位或实验条件与当前结构化记录不一致，请重新打开计算表单。',
    );
}
