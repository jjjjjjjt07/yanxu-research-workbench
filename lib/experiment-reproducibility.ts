import { z } from 'zod';
import type { Experiment } from './domain';
import { sha256 } from './graph.ts';
const short = z.string().trim().max(500).default('');
const detail = z.string().trim().max(3000).default('');
const hash = z
  .string()
  .trim()
  .regex(/^(?:[a-fA-F0-9]{64})?$/, '哈希须为64位SHA-256，未知时留空。')
  .transform((s) => s.toLowerCase())
  .default('');
export const reproducibilitySchema = z.object({
  codeRevision: short,
  codeHash: hash,
  workingTree: z
    .enum(['unknown', 'clean', 'modified', 'not_applicable'])
    .default('unknown'),
  uncommittedDiff: z.string().trim().max(10000).default(''),
  inputDataHash: hash,
  randomSeed: short,
  environment: detail,
  hardware: detail,
  hyperparameters: detail,
  dataSplit: detail,
  preprocessing: detail,
  executionTime: short,
});
export type Reproducibility = z.infer<typeof reproducibilitySchema>;
export type ReproducibilityRecord = {
  metadata: Reproducibility;
  actor: string;
  at: string;
  reason: string;
  sourceVersionId: string;
  resultDataHash: string;
};
export const reproducibilityFields = {
  codeRevision: '代码提交号 / 版本标识',
  codeHash: '代码SHA-256',
  inputDataHash: '输入数据SHA-256',
  randomSeed: '随机种子 / 不适用说明',
  environment: '环境锁文件 / 镜像标识',
  hardware: '硬件',
  hyperparameters: '超参数',
  dataSplit: '数据划分',
  preprocessing: '预处理',
  executionTime: '运行时间、时区及耗时',
} as const;
export function missingReproducibility(record?: ReproducibilityRecord) {
  const m = record?.metadata;
  const missing: string[] = Object.entries(reproducibilityFields)
    .filter(
      ([key]) =>
        !(
          m?.workingTree === 'not_applicable' &&
          (key === 'codeRevision' || key === 'codeHash')
        ),
    )
    .filter(([key]) => !m?.[key as keyof typeof reproducibilityFields]?.trim())
    .map(([, label]) => label);
  if (!m || m.workingTree === 'unknown') missing.push('代码工作区状态');
  if (m?.workingTree === 'modified' && !m.uncommittedDiff.trim())
    missing.push('未提交差异');
  return missing;
}
export async function saveReproducibility(
  experiment: Experiment,
  versionId: string,
  metadata: Reproducibility,
  actor: string,
  reason: string,
) {
  const prior = experiment.versions.at(-1);
  if (!prior || prior.id !== versionId)
    throw new Error('实验版本已变化，请重新核对。');
  if (!reason.trim()) throw new Error('请填写复现信息的核对说明。');
  if (experiment.versions.length >= 10)
    throw new Error('当前每个实验最多10个版本；旧版本未覆盖。');
  const checked = reproducibilitySchema.parse(metadata);
  if (checked.workingTree !== 'modified' && checked.uncommittedDiff)
    throw new Error('填写了未提交差异，请将工作区状态设为有修改。');
  const version = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    filename: prior.filename,
    rows: structuredClone(prior.rows),
    ...(prior.statistics
      ? { statistics: structuredClone(prior.statistics) }
      : {}),
    ...(prior.csvSource ? { csvSource: structuredClone(prior.csvSource) } : {}),
    ...(prior.scope ? { scope: structuredClone(prior.scope) } : {}),
    reproducibility: {
      metadata: checked,
      actor,
      at: new Date().toISOString(),
      reason: reason.trim(),
      sourceVersionId: prior.id,
      resultDataHash: await sha256(JSON.stringify(prior.rows)),
    },
  };
  experiment.versions.push(version);
  return version;
}
