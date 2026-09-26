'use client';
import { useState } from 'react';
import type { Project } from '@/lib/domain';
import type { Graph } from '@/lib/graph';
import type { Observation, ObservationSnapshot } from '@/lib/observations';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Textarea } from './ui/textarea';
import { Modal, Label, request } from './common';
import { ReproducibilitySummary } from './experiment-reproducibility';
import { ExperimentScopeSummary } from './experiment-scope';
import {
  calculationReferences,
  calculationKey,
  calculationIndices,
} from '@/lib/calculation-reference';
import { CalculationSnapshot, calculationLabel } from './calculation-snapshot';
const states = { recorded: '已记录', stale: '待复查', withdrawn: '已撤回' };
const outcomes = {
  supports: '初步支持',
  contradicts: '出现反例',
  inconclusive: '尚无定论',
};

export function Snapshot({ value }: { value: ObservationSnapshot }) {
  return (
    <div>
      <p style={{ whiteSpace: 'pre-wrap' }}>{value.text}</p>
      <p>
        人工判断：{outcomes[value.outcome]} · 适用条件：{value.conditions}
      </p>
      {value.calculation && <CalculationSnapshot value={value.calculation} />}
      <p>
        {value.experiment.name} · {value.experiment.filename} ·{' '}
        {value.experiment.direction === 'higher'
          ? '指标越大越好'
          : '指标越小越好'}
      </p>
      {value.calculation && (
        <p>
          以下保留该计算使用的全部{value.experiment.rows.length}
          条输入，不是人工挑选的部分行。
        </p>
      )}
      <div
        style={{ overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}
        role="region"
        aria-label="观察数据快照，可滚动"
        tabIndex={0}
      >
        <table className="experiment-summary-table">
          <thead>
            <tr>
              <th>数据行</th>
              <th>方法</th>
              <th>运行编号</th>
              <th>数据集</th>
              <th>指标</th>
              <th>数值</th>
              <th>来源行</th>
            </tr>
          </thead>
          <tbody>
            {value.experiment.rows.map((r) => (
              <tr key={r.index}>
                <td>{r.index + 1}</td>
                <td>{r.value.method}</td>
                <td>{r.value.runId ?? '未编号'}</td>
                <td>{r.value.dataset}</td>
                <td>{r.value.metric}</td>
                <td>{r.value.value}</td>
                <td>
                  {r.sourceRow
                    ? `${r.sourceRow.startLine}—${r.sourceRow.endLine}`
                    : '未留存'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {value.experiment.csvSource && (
        <p style={{ overflowWrap: 'anywhere' }}>
          {value.experiment.csvSource.origin === 'file'
            ? 'CSV上传原件'
            : 'CSV导入文本'}{' '}
          SHA-256：{value.experiment.csvSource.sha256}；来源行对应此文件。
        </p>
      )}
      <ReproducibilitySummary record={value.experiment.reproducibility} />
      {value.experiment.scope && (
        <ExperimentScopeSummary
          record={value.experiment.scope}
          rows={value.experiment.rows.map((row) => row.value)}
        />
      )}
      {!!value.experiment.artifacts?.length && (
        <details>
          <summary>
            复现附件与独立核对 · {value.experiment.artifacts.length}个附件 ·{' '}
            {value.experiment.reproductions?.length ?? 0}条核对
          </summary>
          {value.experiment.artifacts.map((artifact) => (
            <p key={artifact.id}>
              {artifact.filename} · {artifact.kind} · SHA-256：
              {artifact.sha256}
            </p>
          ))}
          {value.experiment.reproductions?.map((record) => (
            <div className="note" key={record.id}>
              <strong>{record.result}</strong> · {record.executor}
              <p>{record.findings}</p>
              <small>用户确认记录；软件仅验证附件哈希与版本关联。</small>
            </div>
          ))}
        </details>
      )}
      {value.hypothesis && (
        <details>
          <summary>关联时的假设与原文依据</summary>
          <p>{value.hypothesis.snapshot.bridge.question}</p>
          <p>概念映射：{value.hypothesis.snapshot.bridge.mapping}</p>
          <p>风险：{value.hypothesis.snapshot.bridge.risks}</p>
          <p>建议实验：{value.hypothesis.snapshot.bridge.experiment}</p>
          <p>
            关联时图谱 v{value.hypothesis.graphRevision}；假设仍需独立核对。
          </p>
          {value.hypothesis.snapshot.evidence.map((e) => (
            <blockquote key={e.id}>
              第{e.page}页：{e.quote}
            </blockquote>
          ))}
        </details>
      )}
      <small>
        {value.at} · {value.actor} · {value.reason}
      </small>
    </div>
  );
}

export function Observations({
  project,
  onProject,
  experimentId,
  bridgeId,
  onChanged,
}: {
  project: Project;
  onProject: (p: Project) => void;
  experimentId?: string;
  bridgeId?: string;
  onChanged?: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState<{
    project: Project;
    graph: Graph;
    observation?: Observation;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const records = (project.state.observations ?? []).filter(
    (o) =>
      (!experimentId || o.experiment.id === experimentId) &&
      (!bridgeId || o.hypothesis?.snapshot.bridge.id === bridgeId),
  );
  async function open(id?: string) {
    setBusy(true);
    setError('');
    try {
      const [p, g] = await Promise.all([
        request<{ project: Project }>(`/api/projects/${project.id}`),
        request<{ graph: Graph; projectRevision: number }>(
          `/api/projects/${project.id}/graph`,
        ),
      ]);
      if (p.project.revision !== g.projectRevision)
        throw new Error('资料正在更新，请重新打开。');
      onProject(p.project);
      setEditing({
        project: p.project,
        graph: g.graph,
        observation: p.project.state.observations?.find((o) => o.id === id),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      style={{
        padding: 16,
        borderTop: '1px solid var(--border)',
        marginTop: 16,
      }}
    >
      <h3>实验观察{bridgeId ? ' · 此假设' : ''}</h3>
      <p className="secondary">
        保留所选原始数据或已保存计算、条件和人工判断；可在问答及稿件中引用。数据或假设变化后需要复查，记录不自动证明假设。
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={busy || !project.state.experiments.length}
        onClick={() => open()}
      >
        记录实验观察
      </Button>
      {!project.state.experiments.length && <p>请先在实验页导入数据。</p>}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {records.map((o) => (
        <details key={o.id} className="note">
          <summary>
            {states[o.status]} · {o.text.slice(0, 100)}
          </summary>
          <Snapshot value={o} />
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => open(o.id)}
          >
            核对 / 修改观察
          </Button>
          <details>
            <summary>观察变更历史（{o.history.length}）</summary>
            {o.history.toReversed().map((h, i) => (
              <div key={i}>
                <strong>{states[h.status]}</strong>
                <Snapshot value={h} />
              </div>
            ))}
          </details>
        </details>
      ))}
      {editing && (
        <ObservationEditor
          project={editing.project}
          graph={editing.graph}
          observation={editing.observation}
          experimentId={experimentId}
          bridgeId={bridgeId}
          onClose={() => setEditing(null)}
          onSaved={async (p) => {
            onProject(p);
            setEditing(null);
            if (onChanged) await onChanged();
          }}
        />
      )}
    </section>
  );
}

function ObservationEditor({
  project,
  graph,
  observation,
  experimentId,
  bridgeId,
  onSaved,
  onClose,
}: {
  project: Project;
  graph: Graph;
  observation?: Observation;
  experimentId?: string;
  bridgeId?: string;
  onSaved: (p: Project) => Promise<void>;
  onClose: () => void;
}) {
  const priorExperiment = observation ? observation.experiment : null;
  const priorHypothesis = observation ? observation.hypothesis : null;
  const initialExperimentId = priorExperiment
    ? priorExperiment.id
    : experimentId ||
      (project.state.experiments[0] ? project.state.experiments[0].id : '');
  const [expId, setExpId] = useState(initialExperimentId);
  const [hypothesisId, setHypothesisId] = useState(
    priorHypothesis ? priorHypothesis.snapshot.bridge.id : bridgeId || '',
  );
  const current = project.state.experiments.find((e) => e.id === expId);
  const version = current ? current.versions.at(-1) : undefined;
  const [sourceKey, setSourceKey] = useState(
    observation?.calculation ? calculationKey(observation.calculation) : 'rows',
  );
  const [calculationConfirmed, setCalculationConfirmed] = useState(false);
  const calculations = current
    ? calculationReferences(current).filter(
        (r) => r.record.versionId === version?.id,
      )
    : [];
  const calculation = calculations.find((r) => calculationKey(r) === sourceKey);
  const outdatedCalculation = sourceKey !== 'rows' && !calculation;
  const [indices, setIndices] = useState<number[]>(
    priorExperiment && version && priorExperiment.versionId === version.id
      ? priorExperiment.rows.map((r) => r.index)
      : [],
  );
  const [text, setText] = useState(observation ? observation.text : '');
  const [conditions, setConditions] = useState(
    observation ? observation.conditions : '',
  );
  const [outcome, setOutcome] = useState<Observation['outcome']>(
    observation ? observation.outcome : 'inconclusive',
  );
  const [reason, setReason] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function save(action: 'save' | 'withdraw') {
    setBusy(true);
    setError('');
    try {
      const data = await request<{ project: Project }>(
        `/api/projects/${project.id}/observations`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            action,
            id: observation ? observation.id : undefined,
            projectRevision: project.revision,
            graphRevision: graph.revision,
            experimentId: expId,
            experimentVersionId: version ? version.id : '',
            rowIndices: sourceKey === 'rows' ? indices : [],
            ...(calculation
              ? {
                  calculation: {
                    kind: calculation.kind,
                    id: calculation.record.id,
                    confirmed: calculationConfirmed,
                  },
                }
              : {}),
            bridgeId: hypothesisId || undefined,
            text,
            conditions,
            outcome,
            reason,
          }),
        },
      );
      await onSaved(data.project);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="核对实验观察"
      description="选择实际数据，记录适用条件和对预期的人工判断。"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {observation && (
        <details>
          <summary>此前观察与数据快照</summary>
          <Snapshot value={observation} />
        </details>
      )}
      <Label title="当前实验">
        <select
          aria-label="观察实验"
          value={expId}
          disabled={busy}
          style={{ width: '100%' }}
          onChange={(e) => {
            setExpId(e.target.value);
            setIndices([]);
            setSourceKey('rows');
            setCalculationConfirmed(false);
          }}
        >
          {project.state.experiments.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      </Label>
      <Label title="观察的数值依据">
        <select
          aria-label="观察数值依据"
          value={sourceKey}
          disabled={busy}
          style={{ width: '100%' }}
          onChange={(e) => {
            setSourceKey(e.target.value);
            setCalculationConfirmed(false);
          }}
        >
          <option value="rows">手动选择原始数据行</option>
          {outdatedCalculation && (
            <option value={sourceKey} disabled>
              旧计算已失效，请重新选择当前计算
            </option>
          )}
          {calculations.map((r) => (
            <option key={calculationKey(r)} value={calculationKey(r)}>
              {calculationLabel(r)}
            </option>
          ))}
        </select>
      </Label>
      {!calculations.length && (
        <p className="secondary">
          当前版本没有保存的区间或两组比较；可先在实验页计算，再来引用。
        </p>
      )}
      {calculation && (
        <>
          <CalculationSnapshot value={calculation} />
          <p>
            自动包含全部{calculationIndices(calculation).length}
            条计算输入及前提，服务器保存前复算核对。观察文字和判断仍由你填写。
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <Checkbox
              aria-label="我已核对这次计算的输入、统计前提与适用范围"
              checked={calculationConfirmed}
              disabled={busy}
              onCheckedChange={(checked) =>
                setCalculationConfirmed(checked === true)
              }
            />
            我已核对这次计算的输入、统计前提与适用范围
          </div>
        </>
      )}
      {sourceKey === 'rows' && (
        <>
          <p className="secondary">
            选取1—20条导入后的数据行。版本更新后需重新选择；这里保留数据快照，不自动计算统计显著性。
          </p>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {version &&
              version.rows.map((r, i) => (
                <label
                  key={i}
                  style={{ display: 'flex', gap: 8, margin: '8px 0' }}
                >
                  <Checkbox
                    checked={indices.includes(i)}
                    disabled={
                      busy || (!indices.includes(i) && indices.length >= 20)
                    }
                    onCheckedChange={(checked) =>
                      setIndices((old) =>
                        checked
                          ? [...old, i]
                          : old.filter((index) => index !== i),
                      )
                    }
                  />
                  行{i + 1} · {r.method} / {r.dataset} / {r.metric}
                  {r.runId ? ` / ${r.runId}` : ''}：{r.value}
                </label>
              ))}
          </div>
        </>
      )}
      <Label title="关联桥接假设（可选）">
        <select
          aria-label="观察关联假设"
          value={hypothesisId}
          disabled={busy}
          style={{ width: '100%' }}
          onChange={(e) => setHypothesisId(e.target.value)}
        >
          <option value="">不关联假设</option>
          {graph.bridges.map((b) => (
            <option key={b.id} value={b.id}>
              {b.question.slice(0, 100)}
            </option>
          ))}
        </select>
      </Label>
      {hypothesisId && (
        <p className="secondary">
          关联保留当时假设和依据；候选或待复查假设仍保持原状态。原文版本已变化时，请先重新构图核对。改选假设或取消关联会保留旧关联历史。
        </p>
      )}
      <Label title="待验证预期与实际观察">
        <Textarea
          aria-label="实验观察内容"
          rows={3}
          maxLength={3000}
          disabled={busy}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </Label>
      <Label title="适用条件与限制">
        <Textarea
          aria-label="实验观察条件"
          rows={2}
          maxLength={2000}
          disabled={busy}
          value={conditions}
          onChange={(e) => setConditions(e.target.value)}
        />
      </Label>
      <Label title="对预期的人工判断">
        <select
          aria-label="实验观察判断"
          value={outcome}
          disabled={busy}
          onChange={(e) => setOutcome(e.target.value as Observation['outcome'])}
        >
          {Object.entries(outcomes).map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
      </Label>
      <Label title="保存 / 撤回说明">
        <Textarea
          aria-label="实验观察核对说明"
          rows={2}
          maxLength={1200}
          disabled={busy}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Label>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <Button
          disabled={
            busy ||
            !version ||
            (sourceKey === 'rows'
              ? !indices.length
              : !calculation || !calculationConfirmed) ||
            !text.trim() ||
            !conditions.trim() ||
            !reason.trim()
          }
          onClick={() => save('save')}
        >
          保存观察
        </Button>
        {observation && observation.status !== 'withdrawn' && (
          <Button
            variant="outline"
            disabled={busy || !reason.trim()}
            onClick={() => save('withdraw')}
          >
            撤回观察
          </Button>
        )}
      </div>
    </Modal>
  );
}
