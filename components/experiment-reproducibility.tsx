'use client';
import { useState } from 'react';
import type { Experiment, Project } from '@/lib/domain';
import {
  reproducibilityFields,
  missingReproducibility,
  reproducibilitySchema,
  type Reproducibility,
  type ReproducibilityRecord,
} from '@/lib/experiment-reproducibility';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Modal, Label, request } from './common';
const treeNames = {
  unknown: '未记录',
  clean: '无未提交修改',
  modified: '有未提交修改',
  not_applicable: '不使用代码工作区',
};
export function ReproducibilitySummary({
  record,
}: {
  record?: ReproducibilityRecord;
}) {
  const missing = missingReproducibility(record);
  return (
    <details style={{ overflowWrap: 'anywhere' }}>
      <summary>
        复现资料 ·{' '}
        {missing.length ? `缺少${missing.length}项` : '各项已填写，未验证复现'}
      </summary>
      <p className="secondary">
        {missing.length
          ? '未记录：' + missing.join('、')
          : '填写完整只表示有记录，不表示文件已独立校验或实验可成功复现。'}
      </p>
      {record && (
        <>
          <dl>
            {Object.entries(reproducibilityFields).map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd style={{ whiteSpace: 'pre-wrap' }}>
                  {record.metadata[key as keyof typeof reproducibilityFields] ||
                    '未记录'}
                </dd>
              </div>
            ))}
          </dl>
          <p>代码工作区：{treeNames[record.metadata.workingTree]}</p>
          {record.metadata.uncommittedDiff && (
            <details>
              <summary>保留的未提交差异</summary>
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  maxHeight: 250,
                  overflowY: 'auto',
                }}
              >
                {record.metadata.uncommittedDiff}
              </pre>
            </details>
          )}
          <p>结果数据SHA-256（软件计算）：{record.resultDataHash}</p>
          <small>
            {record.at} · {record.actor} · {record.reason}
          </small>
        </>
      )}
    </details>
  );
}
export function ExperimentReproducibility({
  project,
  experiment,
  onProject,
}: {
  project: Project;
  experiment: Experiment;
  onProject: (p: Project) => void;
}) {
  const [editing, setEditing] = useState<{
    project: Project;
    experiment: Experiment;
  } | null>(null);
  const version = experiment.versions.at(-1);
  return (
    <section className="panel" style={{ padding: 24, marginTop: 20 }}>
      <h3>实验复现资料</h3>
      <p className="secondary">
        记录代码、输入数据、环境与执行条件。软件计算导入结果的哈希；其余内容由你填写，未知项可以留空。
      </p>
      <ReproducibilitySummary record={version?.reproducibility} />
      <Button
        variant="outline"
        disabled={!version || experiment.versions.length >= 10}
        onClick={() => setEditing({ project, experiment })}
      >
        补充 / 修正复现资料
      </Button>
      {experiment.versions.length >= 10 && (
        <p>当前实验已达10个版本上限，旧记录仍保留。</p>
      )}
      {editing && (
        <Editor
          project={editing.project}
          experiment={editing.experiment}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            onProject(p);
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}
function Editor({
  project,
  experiment,
  onClose,
  onSaved,
}: {
  project: Project;
  experiment: Experiment;
  onClose: () => void;
  onSaved: (p: Project) => void;
}) {
  const version = experiment.versions.at(-1)!;
  const [metadata, setMetadata] = useState<Reproducibility>(
    version.reproducibility
      ? structuredClone(version.reproducibility.metadata)
      : reproducibilitySchema.parse({}),
  );
  const [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError('');
    try {
      const checked = reproducibilitySchema.parse(metadata);
      const saved = await request<Project>(`/api/projects/${project.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'experiment.reproducibility',
          revision: project.revision,
          id: experiment.id,
          versionId: version.id,
          metadata: checked,
          reason,
        }),
      });
      onSaved(saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="记录实验复现资料"
      description={experiment.name}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="secondary">
        保存会新建实验版本，保留原数值和此前资料，相关观察与稿件引用需重新核对。程序不会自动读取你的设备信息或代码目录。
      </p>
      {Object.entries(reproducibilityFields).map(([key, label]) => (
        <Label title={label} key={key}>
          <Textarea
            aria-label={label}
            disabled={busy}
            rows={
              key === 'codeHash' ||
              key === 'inputDataHash' ||
              key === 'randomSeed' ||
              key === 'codeRevision' ||
              key === 'executionTime'
                ? 1
                : 2
            }
            maxLength={
              key === 'codeHash' || key === 'inputDataHash'
                ? 64
                : key === 'codeRevision' ||
                    key === 'randomSeed' ||
                    key === 'executionTime'
                  ? 500
                  : 3000
            }
            value={metadata[key as keyof typeof reproducibilityFields]}
            onChange={(e) =>
              setMetadata((old) => ({ ...old, [key]: e.target.value }))
            }
          />
        </Label>
      ))}
      <Label title="代码工作区状态">
        <select
          aria-label="代码工作区状态"
          value={metadata.workingTree}
          disabled={busy}
          onChange={(e) =>
            setMetadata((old) => ({
              ...old,
              workingTree: e.target.value as Reproducibility['workingTree'],
            }))
          }
        >
          {Object.entries(treeNames).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </Label>
      <Label title="未提交差异（有修改时记录）">
        <Textarea
          aria-label="未提交差异"
          disabled={busy}
          value={metadata.uncommittedDiff}
          onChange={(e) =>
            setMetadata((old) => ({ ...old, uncommittedDiff: e.target.value }))
          }
          rows={4}
          maxLength={10000}
        />
      </Label>
      <Label title="本次核对说明">
        <Textarea
          aria-label="复现资料核对说明"
          disabled={busy}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          maxLength={1200}
        />
      </Label>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <Button disabled={busy || !reason.trim()} onClick={save}>
        保存为新版本
      </Button>
    </Modal>
  );
}
