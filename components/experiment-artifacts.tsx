'use client';

import { useState } from 'react';
import type { Experiment, Project } from '@/lib/domain';
import type {
  ExperimentArtifact,
  IndependentReproduction,
} from '@/lib/experiment-artifacts';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label, Modal, request } from './common';

const kindNames = {
  code: '代码包 / 源码快照',
  environment: '环境锁定文件 / 镜像清单',
  execution: '运行日志',
  result: '复现结果',
  other: '其他材料',
};
const resultNames = {
  reproduced: '在所列条件下复现',
  not_reproduced: '未能复现',
  inconclusive: '尚无定论',
};

function encode(bytes: Uint8Array) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192)
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(binary);
}

export function ExperimentArtifacts({
  project,
  experiment,
  onProject,
}: {
  project: Project;
  experiment: Experiment;
  onProject: (project: Project) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const version = experiment.versions.at(-1)!;
  const artifacts = (experiment.artifacts ?? []).filter(
    (artifact) => artifact.versionId === version.id,
  );
  const records = (experiment.reproductions ?? []).filter(
    (record) => record.versionId === version.id,
  );
  const kinds = new Set(artifacts.map((artifact) => artifact.kind));
  const ready =
    kinds.has('code') &&
    kinds.has('environment') &&
    (kinds.has('execution') || kinds.has('result'));
  return (
    <section className="panel" style={{ padding: 24, marginTop: 20 }}>
      <h3>复现附件与独立核对</h3>
      <p className="secondary">
        附件保存原始字节与SHA-256。独立复现结论由核对人填写；系统验证附件完整性和版本关联，不验证执行者身份，也不自动运行代码。
      </p>
      <div className="row">
        <Button
          variant="outline"
          disabled={(experiment.artifacts?.length ?? 0) >= 20}
          onClick={() => setUploading(true)}
        >
          添加复现附件
        </Button>
        <Button
          variant="outline"
          disabled={!ready || (experiment.reproductions?.length ?? 0) >= 20}
          onClick={() => setVerifying(true)}
        >
          记录独立复现核对
        </Button>
      </div>
      {!artifacts.length ? (
        <p>当前版本尚无附件。</p>
      ) : (
        artifacts.map((artifact) => (
          <ArtifactRow
            key={artifact.id}
            projectId={project.id}
            artifact={artifact}
          />
        ))
      )}
      {!ready && artifacts.length > 0 && (
        <p className="help-text">
          建立独立核对至少需要代码、环境，以及运行日志或结果附件。
        </p>
      )}
      {records.map((record) => (
        <ReproductionRow
          key={record.id}
          record={record}
          artifacts={artifacts}
        />
      ))}
      {uploading && (
        <ArtifactEditor
          project={project}
          experiment={experiment}
          onClose={() => setUploading(false)}
          onSaved={(saved) => {
            onProject(saved);
            setUploading(false);
          }}
        />
      )}
      {verifying && (
        <ReproductionEditor
          project={project}
          experiment={experiment}
          artifacts={artifacts}
          onClose={() => setVerifying(false)}
          onSaved={(saved) => {
            onProject(saved);
            setVerifying(false);
          }}
        />
      )}
    </section>
  );
}

function ArtifactRow({
  projectId,
  artifact,
}: {
  projectId: string;
  artifact: ExperimentArtifact;
}) {
  return (
    <div className="note">
      <strong>{kindNames[artifact.kind]}</strong> · {artifact.filename}
      <p>{artifact.note}</p>
      <small>
        {artifact.size} 字节 · SHA-256：{artifact.sha256}
      </small>
      <div>
        <a
          href={`/api/projects/${projectId}/experiments/artifacts?artifactId=${encodeURIComponent(artifact.id)}`}
          download
        >
          下载并校验附件
        </a>
      </div>
    </div>
  );
}

function ReproductionRow({
  record,
  artifacts,
}: {
  record: IndependentReproduction;
  artifacts: ExperimentArtifact[];
}) {
  return (
    <details className="note">
      <summary>
        独立复现核对 · {resultNames[record.result]} · {record.executor}
      </summary>
      <p>独立性依据：{record.independenceBasis}</p>
      <p style={{ whiteSpace: 'pre-wrap' }}>核对结果：{record.findings}</p>
      <p>
        附件：
        {record.artifactIds
          .map(
            (id) => artifacts.find((artifact) => artifact.id === id)?.filename,
          )
          .filter(Boolean)
          .join('、')}
      </p>
      <p className="help-text">
        用户确认的核对记录；软件只校验所列附件的哈希与版本关联。
      </p>
      <small>
        {record.at} · {record.actor} · {record.reason}
      </small>
    </details>
  );
}

function ArtifactEditor({
  project,
  experiment,
  onClose,
  onSaved,
}: {
  project: Project;
  experiment: Experiment;
  onClose: () => void;
  onSaved: (project: Project) => void;
}) {
  const [kind, setKind] = useState<ExperimentArtifact['kind']>('code');
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      if (file.size > 2_000_000) throw new Error('附件须不超过2MB。');
      const bytes = new Uint8Array(await file.arrayBuffer());
      onSaved(
        await request<Project>(
          `/api/projects/${project.id}/experiments/artifacts`,
          {
            method: 'POST',
            body: JSON.stringify({
              revision: project.revision,
              experimentId: experiment.id,
              versionId: experiment.versions.at(-1)!.id,
              kind,
              filename: file.name,
              note,
              base64: encode(bytes),
            }),
          },
        ),
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="添加复现附件"
      description="保留原始文件字节，不自动执行其中内容。"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <Label title="附件类型">
        <select
          aria-label="复现附件类型"
          value={kind}
          disabled={busy}
          onChange={(event) =>
            setKind(event.target.value as ExperimentArtifact['kind'])
          }
        >
          {Object.entries(kindNames).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
      </Label>
      <Label title="文件（最大2MB）">
        <Input
          type="file"
          aria-label="选择复现附件"
          disabled={busy}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </Label>
      <Label title="附件用途说明">
        <Textarea
          aria-label="复现附件用途说明"
          rows={2}
          maxLength={1200}
          disabled={busy}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Label>
      {error && <p className="error-text">{error}</p>}
      <Button disabled={busy || !file || !note.trim()} onClick={save}>
        保存附件
      </Button>
    </Modal>
  );
}

function ReproductionEditor({
  project,
  experiment,
  artifacts,
  onClose,
  onSaved,
}: {
  project: Project;
  experiment: Experiment;
  artifacts: ExperimentArtifact[];
  onClose: () => void;
  onSaved: (project: Project) => void;
}) {
  const [executor, setExecutor] = useState('');
  const [basis, setBasis] = useState('');
  const [result, setResult] =
    useState<IndependentReproduction['result']>('inconclusive');
  const [findings, setFindings] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save() {
    setBusy(true);
    setError('');
    try {
      onSaved(
        await request<Project>(
          `/api/projects/${project.id}/experiments/artifacts`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              revision: project.revision,
              experimentId: experiment.id,
              versionId: experiment.versions.at(-1)!.id,
              artifactIds: artifacts.map((artifact) => artifact.id),
              executor,
              independenceBasis: basis,
              result,
              findings,
              confirmed,
              reason,
            }),
          },
        ),
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="记录独立复现核对"
      description="只记录有附件支持的人工核对结论。"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p>本次引用当前版本的全部{artifacts.length}个复现附件。</p>
      <Label title="复现执行者 / 团队">
        <Input
          aria-label="独立复现执行者"
          maxLength={500}
          disabled={busy}
          value={executor}
          onChange={(event) => setExecutor(event.target.value)}
        />
      </Label>
      <Label title="与原实验独立的依据">
        <Textarea
          aria-label="独立复现依据"
          rows={2}
          maxLength={1500}
          disabled={busy}
          value={basis}
          onChange={(event) => setBasis(event.target.value)}
        />
      </Label>
      <Label title="核对结论">
        <select
          aria-label="独立复现结论"
          value={result}
          disabled={busy}
          onChange={(event) =>
            setResult(event.target.value as IndependentReproduction['result'])
          }
        >
          {Object.entries(resultNames).map(([value, label]) => (
            <option value={value} key={value}>
              {label}
            </option>
          ))}
        </select>
      </Label>
      <Label title="结果差异与限制">
        <Textarea
          aria-label="独立复现结果与限制"
          rows={3}
          maxLength={3000}
          disabled={busy}
          value={findings}
          onChange={(event) => setFindings(event.target.value)}
        />
      </Label>
      <Label title="本次核对说明">
        <Textarea
          aria-label="独立复现核对说明"
          rows={2}
          maxLength={1200}
          disabled={busy}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Label>
      <div style={{ display: 'flex', gap: 8 }}>
        <Checkbox
          aria-label="确认独立复现核对"
          checked={confirmed}
          disabled={busy}
          onCheckedChange={(value) => setConfirmed(value === true)}
        />
        <span>
          我已核对执行者、独立性依据、附件和结果；理解软件未自动执行或验证复现实验
        </span>
      </div>
      {error && <p className="error-text">{error}</p>}
      <Button
        disabled={
          busy ||
          !executor.trim() ||
          !basis.trim() ||
          !findings.trim() ||
          !reason.trim() ||
          !confirmed
        }
        onClick={save}
      >
        保存复现核对
      </Button>
    </Modal>
  );
}
