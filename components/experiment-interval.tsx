'use client';
import { useState } from 'react';
import {
  LineChart,
  Line,
  ErrorBar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import { ChartContainer } from './ui/chart';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Label, Modal, request, downloadFile } from './common';
import type { Project, Experiment } from '@/lib/domain';
import { findExperimentScope } from '@/lib/experiment-scope';
import type { MeanInterval } from '@/lib/experiment-interval';
const format = (n: number) => String(Number(n.toPrecision(8)));
const fieldLabels = {
  unit: '指标单位（例如：准确率百分点）',
  samplingUnit: '一个独立观测代表什么（例如：一次完整训练）',
  conditions: '相同实验条件及适用范围',
  independenceBasis: '运行相互独立的依据',
  distributionBasis: '运行结果近似正态的依据及限制',
} as const;
export function ExperimentIntervalPanel({
  project,
  experiment,
  dataset,
  metric,
  onProject,
}: {
  project: Project;
  experiment: Experiment;
  dataset: string;
  metric: string;
  onProject: (p: Project) => void;
}) {
  const [editing, setEditing] = useState<{
    project: Project;
    experiment: Experiment;
    method: string;
    dataset: string;
    metric: string;
  } | null>(null);
  const current = experiment.versions.at(-1)!;
  const methods = [
    ...new Set(
      current.rows
        .filter((r) => r.dataset === dataset && r.metric === metric)
        .map((r) => r.method),
    ),
  ];
  const records = experiment.intervals ?? [];
  return (
    <section className="panel" style={{ padding: 24, marginTop: 20 }}>
      <h3>均值置信区间</h3>
      <p>
        每次计算一个方法在指定数据集、指标下的双侧95%均值区间。先核对独立运行、相同条件与分布前提；程序不自动验证这些前提。
      </p>
      <div className="row">
        {methods.map((method) => (
          <Button
            variant="outline"
            key={method}
            disabled={records.length >= 50}
            onClick={() =>
              setEditing({ project, experiment, method, dataset, metric })
            }
          >
            {method}：设置并计算
          </Button>
        ))}
      </div>
      {records.length >= 50 && <p>已达50条计算记录上限，历史记录仍保留。</p>}
      <p className="help-text">
        仅估计单组均值；不用于判断两组差异显著，也不表示各次运行值的95%范围。多组同时推断需要另行处理多重比较。
      </p>
      {!records.length && <p>尚未保存区间计算。</p>}
      {records.toReversed().map((record) => (
        <details key={record.id}>
          <summary>
            {record.method} / {record.dataset} / {record.metric} ·{' '}
            {record.versionId === current.id
              ? '当前数据版本'
              : '旧版本，当前数据需重新计算'}{' '}
            · {record.at}
          </summary>
          <IntervalResult record={record} />
          <Button
            variant="ghost"
            onClick={() =>
              downloadFile(
                `${experiment.name}-${record.id}-均值区间.json`,
                JSON.stringify(
                  {
                    record,
                    version: experiment.versions.find(
                      (v) => v.id === record.versionId,
                    ),
                  },
                  null,
                  2,
                ),
                'application/json',
              )
            }
          >
            下载计算记录和输入版本
          </Button>
        </details>
      ))}
      {editing && (
        <IntervalEditor
          key={editing.experiment.versions.at(-1)!.id + editing.method}
          {...editing}
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
export function IntervalResult({ record: r }: { record: MeanInterval }) {
  return (
    <div>
      <p>
        均值 {format(r.mean)}；95%区间 [{format(r.lower)}, {format(r.upper)}]{' '}
        {r.assumptions.unit}；n=
        {r.n}，自由度={r.df}。
      </p>
      <ChartContainer
        config={{ mean: { label: '均值', color: '#426cdd' } }}
        style={{ height: 220, width: '100%' }}
        aria-label="均值与双侧95%置信区间误差条"
      >
        <LineChart
          data={[{ name: r.method, mean: r.mean, error: r.margin }]}
          margin={{ top: 20, right: 25, bottom: 10, left: 25 }}
        >
          <CartesianGrid />
          <XAxis dataKey="name" />
          <YAxis
            domain={[r.lower, r.upper]}
            tickFormatter={(n) => Number(n).toPrecision(4)}
          />
          <Line
            dataKey="mean"
            stroke="#426cdd"
            dot={{ r: 5 }}
            isAnimationActive={false}
          >
            <ErrorBar
              dataKey="error"
              width={12}
              strokeWidth={2}
              isAnimationActive={false}
            />
          </Line>
        </LineChart>
      </ChartContainer>
      <p>
        误差条为均值置信区间，不是标准差。记录由 {r.actor} 于 {r.at} 保存：
        {r.reason}
      </p>
      <dl>
        {Object.entries(fieldLabels).map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd style={{ whiteSpace: 'pre-wrap' }}>
              {r.assumptions[key as keyof typeof fieldLabels]}
            </dd>
          </div>
        ))}
      </dl>
      <p>
        计算：{r.formula}；t临界值={format(r.critical)}；样本标准差=
        {format(r.sampleSD)}
        ；标准误={format(r.standardError)}。
      </p>
      <p className="help-text">显示保留8位有效数字；下载记录保留完整计算值。</p>
      <p style={{ overflowWrap: 'anywhere' }}>
        输入SHA-256：{r.inputDataHash}；数据行：
        {r.indices.map((i) => i + 1).join('、')}；运行编号：
        {r.runIds.join('、')}。
      </p>
    </div>
  );
}
function IntervalEditor({
  project,
  experiment,
  method,
  dataset,
  metric,
  onClose,
  onSaved,
}: {
  project: Project;
  experiment: Experiment;
  method: string;
  dataset: string;
  metric: string;
  onClose: () => void;
  onSaved: (p: Project) => void;
}) {
  const scope = findExperimentScope(
    experiment.versions.at(-1)?.scope,
    dataset,
    metric,
  );
  const [fields, setFields] = useState({
    unit: scope?.unit ?? '',
    samplingUnit: scope?.samplingUnit ?? '',
    conditions: scope?.conditions ?? '',
    independenceBasis: '',
    distributionBasis: '',
  });
  const [independent, setIndependent] = useState(false),
    [normal, setNormal] = useState(false),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function save() {
    setBusy(true);
    setError('');
    try {
      onSaved(
        await request<Project>(`/api/projects/${project.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            action: 'experiment.interval',
            revision: project.revision,
            id: experiment.id,
            versionId: experiment.versions.at(-1)!.id,
            method,
            dataset,
            metric,
            assumptions: { ...fields, independent, approximateNormal: normal },
            reason,
          }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="均值区间的计算前提"
      description={`${method} / ${dataset} / ${metric}`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p>
        使用该分组的全部运行记录，不按结果挑选。至少2次有编号且有变动的运行；小样本结果尤其依赖分布假设。前提不适用或无法判断时，请保留描述统计。
      </p>
      {scope && (
        <p className="secondary">
          指标单位、独立观测单位和实验条件来自当前版本的结构化记录；如需修改，请先回到实验页核对口径。
        </p>
      )}
      {Object.entries(fieldLabels).map(([key, label]) => (
        <Label title={label} key={key}>
          <Textarea
            aria-label={label}
            disabled={
              busy ||
              (!!scope && ['unit', 'samplingUnit', 'conditions'].includes(key))
            }
            rows={key === 'unit' ? 1 : 2}
            maxLength={
              key === 'unit'
                ? 120
                : key === 'samplingUnit'
                  ? 500
                  : key === 'conditions'
                    ? 2000
                    : 1500
            }
            value={fields[key as keyof typeof fields]}
            onChange={(e) =>
              setFields((old) => ({ ...old, [key]: e.target.value }))
            }
          />
        </Label>
      ))}
      <label>
        <input
          type="checkbox"
          checked={independent}
          disabled={busy}
          onChange={(e) => setIndependent(e.target.checked)}
        />
        我已核对独立观测单位，同组记录代表相同条件下相互独立的运行
      </label>
      <label>
        <input
          type="checkbox"
          checked={normal}
          disabled={busy}
          onChange={(e) => setNormal(e.target.checked)}
        />
        我已评估运行结果的分布，接受近似正态前提与上述限制
      </label>
      <Label title="本次计算说明">
        <Textarea
          aria-label="本次计算说明"
          value={reason}
          disabled={busy}
          maxLength={1200}
          onChange={(e) => setReason(e.target.value)}
        />
      </Label>
      <a
        href="https://www.itl.nist.gov/div898/handbook/eda/section3/eda352.htm"
        target="_blank"
        rel="noreferrer"
      >
        公式与区间解释：NIST统计手册
      </a>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <Button
        disabled={
          busy ||
          !independent ||
          !normal ||
          !reason.trim() ||
          Object.values(fields).some((v) => !v.trim())
        }
        onClick={save}
      >
        计算并保存前提与结果
      </Button>
    </Modal>
  );
}
