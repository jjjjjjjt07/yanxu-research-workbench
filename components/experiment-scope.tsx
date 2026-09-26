'use client';

import { useState } from 'react';
import type { Experiment, Project } from '@/lib/domain';
import {
  experimentScopeKeys,
  findExperimentScope,
  type ExperimentScope,
  type ExperimentScopeRecord,
} from '@/lib/experiment-scope';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Label, Modal, request } from './common';

export function ExperimentScopeSummary({
  record,
  rows,
}: {
  record?: ExperimentScopeRecord;
  rows: Experiment['versions'][number]['rows'];
}) {
  const keys = experimentScopeKeys(rows);
  const complete =
    !!record &&
    keys.every((key) => findExperimentScope(record, key.dataset, key.metric));
  return (
    <details style={{ overflowWrap: 'anywhere' }}>
      <summary>
        指标口径与实验条件 ·{' '}
        {complete ? `${keys.length}项已记录` : '未完整记录'}
      </summary>
      <p className="secondary">
        这里按数据集和指标保存单位、独立观测单位与可比较条件。填写完整不表示统计前提已经成立。
      </p>
      {record?.values.map((value) => (
        <div className="note" key={`${value.dataset}\u0000${value.metric}`}>
          <strong>
            {value.dataset} / {value.metric}
          </strong>
          <dl>
            <div>
              <dt>指标单位</dt>
              <dd>{value.unit}</dd>
            </div>
            <div>
              <dt>独立观测单位</dt>
              <dd>{value.samplingUnit}</dd>
            </div>
            <div>
              <dt>实验条件与适用范围</dt>
              <dd style={{ whiteSpace: 'pre-wrap' }}>{value.conditions}</dd>
            </div>
          </dl>
        </div>
      ))}
      {record && (
        <small>
          {record.at} · {record.actor} · {record.reason}
        </small>
      )}
    </details>
  );
}

export function ExperimentScopePanel({
  project,
  experiment,
  onProject,
}: {
  project: Project;
  experiment: Experiment;
  onProject: (project: Project) => void;
}) {
  const [editing, setEditing] = useState(false);
  const version = experiment.versions.at(-1)!;
  const count = experimentScopeKeys(version.rows).length;
  return (
    <section className="panel" style={{ padding: 24, marginTop: 20 }}>
      <h3>指标口径与实验条件</h3>
      <p className="secondary">
        先按数据集和指标固定单位、独立观测单位和可比较条件；统计计算会沿用这些记录，避免重复填写时改变口径。
      </p>
      <ExperimentScopeSummary record={version.scope} rows={version.rows} />
      <Button
        variant="outline"
        disabled={experiment.versions.length >= 10 || count > 100}
        onClick={() => setEditing(true)}
      >
        {version.scope ? '核对 / 修正口径' : '记录单位与条件'}
      </Button>
      {count > 100 && (
        <p>当前包含超过100个指标范围，请拆分为多个实验后记录。</p>
      )}
      {experiment.versions.length >= 10 && (
        <p>当前实验已达10个版本上限，旧记录仍保留。</p>
      )}
      {editing && (
        <ScopeEditor
          project={project}
          experiment={experiment}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            onProject(saved);
            setEditing(false);
          }}
        />
      )}
    </section>
  );
}

function ScopeEditor({
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
  const version = experiment.versions.at(-1)!;
  const [values, setValues] = useState<ExperimentScope[]>(() =>
    experimentScopeKeys(version.rows).map((key) => {
      const existing = findExperimentScope(
        version.scope,
        key.dataset,
        key.metric,
      );
      return existing
        ? structuredClone(existing)
        : { ...key, unit: '', samplingUnit: '', conditions: '' };
    }),
  );
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const valid =
    values.length > 0 &&
    values.every(
      (value) =>
        value.unit.trim() &&
        value.samplingUnit.trim() &&
        value.conditions.trim(),
    ) &&
    reason.trim();

  function change(index: number, patch: Partial<ExperimentScope>) {
    setValues((old) =>
      old.map((value, i) => (i === index ? { ...value, ...patch } : value)),
    );
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      onSaved(
        await request<Project>(`/api/projects/${project.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            action: 'experiment.scope',
            revision: project.revision,
            id: experiment.id,
            versionId: version.id,
            values,
            reason,
          }),
        }),
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
      wide
      title="记录指标口径与实验条件"
      description={experiment.name}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="secondary">
        保存会新建实验版本并保留旧记录。每个数据集与指标必须完整填写；之后的区间和两组比较会固定使用这里的三项内容。
      </p>
      {values.map((value, index) => (
        <section className="note" key={`${value.dataset}\u0000${value.metric}`}>
          <h4>
            {value.dataset} / {value.metric}
          </h4>
          <Label title="指标单位">
            <Input
              aria-label={`${value.dataset}/${value.metric} 指标单位`}
              disabled={busy}
              maxLength={120}
              value={value.unit}
              onChange={(event) => change(index, { unit: event.target.value })}
            />
          </Label>
          <Label title="独立观测单位">
            <Textarea
              aria-label={`${value.dataset}/${value.metric} 独立观测单位`}
              disabled={busy}
              rows={2}
              maxLength={500}
              value={value.samplingUnit}
              onChange={(event) =>
                change(index, { samplingUnit: event.target.value })
              }
            />
          </Label>
          <Label title="可比较的实验条件与适用范围">
            <Textarea
              aria-label={`${value.dataset}/${value.metric} 实验条件与适用范围`}
              disabled={busy}
              rows={3}
              maxLength={2000}
              value={value.conditions}
              onChange={(event) =>
                change(index, { conditions: event.target.value })
              }
            />
          </Label>
        </section>
      ))}
      <Label title="本次核对说明">
        <Textarea
          aria-label="指标口径与实验条件核对说明"
          disabled={busy}
          rows={2}
          maxLength={1200}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Label>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <Button disabled={busy || !valid} onClick={save}>
        保存为新版本
      </Button>
    </Modal>
  );
}
