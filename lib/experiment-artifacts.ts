import { z } from 'zod';
import type { Experiment } from './domain.ts';
import { sha256 } from './graph.ts';

export const artifactKindSchema = z.enum([
  'code',
  'environment',
  'execution',
  'result',
  'other',
]);
export type ExperimentArtifact = {
  id: string;
  versionId: string;
  kind: z.infer<typeof artifactKindSchema>;
  filename: string;
  size: number;
  sha256: string;
  note: string;
  actor: string;
  at: string;
};
export type IndependentReproduction = {
  id: string;
  versionId: string;
  artifactIds: string[];
  executor: string;
  independenceBasis: string;
  result: 'reproduced' | 'not_reproduced' | 'inconclusive';
  findings: string;
  verification: 'user_attested_hash_checked_attachments';
  actor: string;
  at: string;
  reason: string;
};

export const reproductionInputSchema = z
  .object({
    artifactIds: z.array(z.string()).min(3).max(20),
    executor: z.string().trim().min(1).max(500),
    independenceBasis: z.string().trim().min(1).max(1500),
    result: z.enum(['reproduced', 'not_reproduced', 'inconclusive']),
    findings: z.string().trim().min(1).max(3000),
    confirmed: z.literal(true),
    reason: z.string().trim().min(1).max(1200),
  })
  .strict();

export function artifactKey(
  owner: string,
  projectId: string,
  artifactId: string,
) {
  return `experiment-artifacts/${encodeURIComponent(owner)}/${projectId}/${artifactId}`;
}

export function decodeArtifact(base64: string) {
  if (
    !base64 ||
    base64.length > 2_666_668 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      base64,
    )
  )
    throw new Error('附件编码无效或超过2MB。');
  const binary = atob(base64);
  if (!binary.length || binary.length > 2_000_000)
    throw new Error('附件须非空且不超过2MB。');
  return Uint8Array.from(binary, (value) => value.charCodeAt(0));
}

export async function addExperimentArtifact(
  experiment: Experiment,
  versionId: string,
  input: {
    kind: ExperimentArtifact['kind'];
    filename: string;
    note: string;
    bytes: Uint8Array;
  },
  actor: string,
) {
  if (experiment.versions.at(-1)?.id !== versionId)
    throw new Error('实验版本已变化，请重新选择附件。');
  if ((experiment.artifacts?.length ?? 0) >= 20)
    throw new Error('当前实验最多保留20个附件，旧附件未覆盖。');
  const artifact: ExperimentArtifact = {
    id: crypto.randomUUID(),
    versionId,
    kind: artifactKindSchema.parse(input.kind),
    filename: input.filename.trim(),
    size: input.bytes.length,
    sha256: await sha256(input.bytes.slice().buffer),
    note: input.note.trim(),
    actor,
    at: new Date().toISOString(),
  };
  if (!artifact.filename || artifact.filename.length > 180)
    throw new Error('附件文件名须为1—180个字符。');
  if (!artifact.note || artifact.note.length > 1200)
    throw new Error('请填写附件用途说明，最多1200个字符。');
  experiment.artifacts = [...(experiment.artifacts ?? []), artifact];
  return artifact;
}

export function recordIndependentReproduction(
  experiment: Experiment,
  versionId: string,
  input: z.infer<typeof reproductionInputSchema>,
  actor: string,
) {
  if (experiment.versions.at(-1)?.id !== versionId)
    throw new Error('实验版本已变化，请重新核对复现资料。');
  if ((experiment.reproductions?.length ?? 0) >= 20)
    throw new Error('当前实验最多保留20条复现核对记录。');
  const checked = reproductionInputSchema.parse(input);
  const ids = new Set(checked.artifactIds);
  if (ids.size !== checked.artifactIds.length)
    throw new Error('复现核对不能重复引用同一附件。');
  const artifacts = checked.artifactIds.map((id) =>
    experiment.artifacts?.find(
      (artifact) => artifact.id === id && artifact.versionId === versionId,
    ),
  );
  if (artifacts.some((artifact) => !artifact))
    throw new Error('复现附件不存在、属于其他实验版本或已失效。');
  const kinds = new Set(artifacts.map((artifact) => artifact!.kind));
  if (
    !kinds.has('code') ||
    !kinds.has('environment') ||
    (!kinds.has('execution') && !kinds.has('result'))
  )
    throw new Error('独立复现至少需要代码、环境以及运行记录或结果附件。');
  const record: IndependentReproduction = {
    id: crypto.randomUUID(),
    versionId,
    artifactIds: [...checked.artifactIds],
    executor: checked.executor,
    independenceBasis: checked.independenceBasis,
    result: checked.result,
    findings: checked.findings,
    verification: 'user_attested_hash_checked_attachments',
    actor,
    at: new Date().toISOString(),
    reason: checked.reason,
  };
  experiment.reproductions = [...(experiment.reproductions ?? []), record];
  return record;
}
