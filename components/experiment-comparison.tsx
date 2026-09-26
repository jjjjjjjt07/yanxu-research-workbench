'use client';
import { useState } from 'react';
import type { Experiment, Project } from '@/lib/domain';
import { findExperimentScope } from '@/lib/experiment-scope';
import type { ExperimentComparison } from '@/lib/experiment-comparison';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Input } from './ui/input';
import { Label, Modal, Picker, request, downloadFile } from './common';
const format = (n: number) => String(Number(n.toPrecision(7)));
const labels = {
  unit: '指标单位',
  samplingUnit: '独立观测单位',
  conditions: '可比较的实验条件与适用范围',
  independenceBasis: '独立性的依据',
  distributionBasis: '分布前提的依据及限制',
} as const;
export function ExperimentComparisonPanel({
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
    dataset: string;
    metric: string;
  } | null>(null);
  const version = experiment.versions.at(-1)!;
  const methods = [
    ...new Set(
      version.rows
        .filter((r) => r.dataset === dataset && r.metric === metric)
        .map((r) => r.method),
    ),
  ];
  const records = experiment.comparisons ?? [];
  return (
    <section className="panel" style={{ padding: 24, marginTop: 20 }}>
      <div className="panel-heading">
        <h3>两组比较</h3>
        <Button
          variant="outline"
          disabled={methods.length < 2 || records.length >= 50}
          onClick={() => setEditing({ project, experiment, dataset, metric })}
        >
          设置比较与统计前提
        </Button>
      </div>
      <p>
        当前范围：{dataset} / {metric}
        。选择独立两组Welch检验，或确认运行编号一一对应后进行配对t检验；使用所选两组的全部记录。
      </p>
      {methods.length < 2 && <p>当前范围需要至少两个不同方法。</p>}
      {records.length >= 50 && <p>已达50条比较记录上限，已有结果仍保留。</p>}
      {!records.length && <p>尚未保存比较结果。</p>}
      {records.toReversed().map((r) => (
        <details key={r.id}>
          <summary>
            {r.sampleA.method} − {r.sampleB.method} ·{' '}
            {r.design === 'paired' ? '配对t' : 'Welch'} · {r.dataset} /{' '}
            {r.metric} ·{' '}
            {r.versionId === version.id ? '当前数据版本' : '旧版本，需重新计算'}
            {' · '}
            <time dateTime={r.at}>{r.at}</time>
          </summary>
          <ComparisonResult record={r} />
          <Button
            variant="ghost"
            onClick={() =>
              downloadFile(
                `${experiment.name}-${r.id}-两组比较.json`,
                JSON.stringify(
                  {
                    record: r,
                    version: experiment.versions.find(
                      (v) => v.id === r.versionId,
                    ),
                  },
                  null,
                  2,
                ),
                'application/json',
              )
            }
          >
            下载计算记录与输入版本
          </Button>
        </details>
      ))}
      {editing && (
        <ComparisonEditor
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
export function ComparisonResult({
  record: r,
}: {
  record: ExperimentComparison;
}) {
  return (
    <div>
      <div
        style={{ overflowX: 'auto' }}
        role="region"
        aria-label="两组统计表，可横向滚动"
        tabIndex={0}
      >
        <table className="experiment-summary-table">
          <thead>
            <tr>
              <th>分组</th>
              <th>运行数</th>
              <th>均值</th>
              <th>样本标准差</th>
            </tr>
          </thead>
          <tbody>
            {[r.sampleA, r.sampleB].map((s, i) => (
              <tr key={i}>
                <td>
                  {i === 0 ? 'A' : 'B'}：{s.method}
                </td>
                <td>{s.n}</td>
                <td>{format(s.mean)}</td>
                <td>{format(s.sampleSD)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        效应量（原单位均值差A−B）：{format(r.effect.value)} {r.effect.unit}
        ；差值区间 [{format(r.lower)}, {format(r.upper)}]。
      </p>
      <p>
        {r.multiplicity.kind === 'single'
          ? '单个预先指定比较，95%差值区间'
          : `Bonferroni校正：共${r.multiplicity.count}次计划比较，本次区间置信水平${format((1 - r.comparisonAlpha) * 100)}%`}
        。
      </p>
      <p>
        双侧原始p={format(r.rawP)}；校正p={format(r.adjustedP)}
        ；整体α=0.05，本次α={format(r.comparisonAlpha)}。
      </p>
      <p>
        {r.rejectNull
          ? '在已填写前提与校正方案下，均值相等假设被拒绝。'
          : '在已填写前提与校正方案下，未拒绝均值相等假设；这不证明两组等效。'}{' '}
        结果不证明因果关系或实际应用价值。
      </p>
      <p>
        t={format(r.t)}；自由度={format(r.df)}；标准误={format(r.standardError)}
        ；t临界值={format(r.critical)}。
      </p>
      <dl>
        {Object.entries(labels).map(([key, label]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd style={{ whiteSpace: 'pre-wrap' }}>
              {r.assumptions[key as keyof typeof labels]}
            </dd>
          </div>
        ))}
      </dl>
      <p style={{ whiteSpace: 'pre-wrap' }}>
        比较计划：{r.multiplicity.plan}
        。总数由用户填写，软件未验证是否覆盖所有相关比较。
      </p>
      {r.pairs && (
        <details>
          <summary>配对依据与逐对差值（{r.pairs.length}对）</summary>
          <p>
            {r.assumptions.pairingBasis}；差值标准差={format(r.differenceSD!)}。
          </p>
          <div
            style={{ overflowX: 'auto' }}
            role="region"
            aria-label="配对差值表，可横向滚动"
            tabIndex={0}
          >
            <table className="experiment-summary-table">
              <thead>
                <tr>
                  <th>运行编号</th>
                  <th>A数据行</th>
                  <th>B数据行</th>
                  <th>A−B</th>
                </tr>
              </thead>
              <tbody>
                {r.pairs.map((p) => (
                  <tr key={p.runId}>
                    <td>{p.runId}</td>
                    <td>{p.indexA + 1}</td>
                    <td>{p.indexB + 1}</td>
                    <td>{format(p.difference)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <details>
        <summary>计算来源</summary>
        <p style={{ overflowWrap: 'anywhere' }}>
          {r.formula}；输入SHA-256：{r.inputDataHash}。
        </p>
        <p>
          {r.actor} · {r.at} · {r.reason}
        </p>
        <p>显示保留7位有效数字；下载记录保留完整计算值和所用数据行。</p>
      </details>
    </div>
  );
}
function ComparisonEditor({
  project,
  experiment,
  dataset,
  metric,
  onClose,
  onSaved,
}: {
  project: Project;
  experiment: Experiment;
  dataset: string;
  metric: string;
  onClose: () => void;
  onSaved: (p: Project) => void;
}) {
  const version = experiment.versions.at(-1)!;
  const scope = findExperimentScope(version.scope, dataset, metric);
  const methods = [
    ...new Set(
      version.rows
        .filter((r) => r.dataset === dataset && r.metric === metric)
        .map((r) => r.method),
    ),
  ];
  const [methodA, setA] = useState(methods[0]),
    [methodB, setB] = useState(methods[1]),
    [design, setDesign] = useState('');
  const [fields, setFields] = useState({
    unit: scope?.unit ?? '',
    samplingUnit: scope?.samplingUnit ?? '',
    conditions: scope?.conditions ?? '',
    independenceBasis: '',
    distributionBasis: '',
  });
  const [independent, setIndependent] = useState(false),
    [normal, setNormal] = useState(false),
    [pairing, setPairing] = useState(false),
    [pairingBasis, setPairingBasis] = useState('');
  const [correction, setCorrection] = useState(''),
    [count, setCount] = useState('2'),
    [plan, setPlan] = useState(''),
    [planConfirmed, setPlanConfirmed] = useState(false);
  const [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const selectedCount = correction === 'single' ? 1 : Number(count);
  function resetAcknowledgements() {
    setIndependent(false);
    setNormal(false);
    setPairing(false);
    setPlanConfirmed(false);
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      onSaved(
        await request<Project>(`/api/projects/${project.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            action: 'experiment.comparison',
            revision: project.revision,
            id: experiment.id,
            versionId: version.id,
            methodA,
            methodB,
            dataset,
            metric,
            design,
            assumptions: {
              ...fields,
              independent,
              approximateNormal: normal,
              pairingConfirmed: design === 'paired' && pairing,
              pairingBasis: design === 'paired' ? pairingBasis : '',
            },
            multiplicity: {
              kind: correction,
              count: selectedCount,
              plan,
              confirmed: planConfirmed,
            },
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
      wide
      title="两组比较的设计与前提"
      description={`${dataset} / ${metric}；双侧检验，原假设均值差为0`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="row">
        <Picker
          label="方法A"
          value={methodA}
          onChange={(value) => {
            setA(value);
            resetAcknowledgements();
          }}
          disabled={busy}
          options={methods.map((m) => ({ value: m, label: m }))}
        />
        <Picker
          label="方法B"
          value={methodB}
          onChange={(value) => {
            setB(value);
            resetAcknowledgements();
          }}
          disabled={busy}
          options={methods.map((m) => ({ value: m, label: m }))}
        />
      </div>
      <Picker
        label="选择独立或配对设计"
        value={design}
        disabled={busy}
        onChange={(v) => {
          setDesign(v);
          resetAcknowledgements();
        }}
        options={[
          { value: 'welch', label: '独立两组：Welch t检验' },
          { value: 'paired', label: '配对：按runId一一对应' },
        ]}
      />
      <p>
        {design === 'paired'
          ? '每对差值A−B是分析对象；不同对相互独立，差值分布需近似正态。相同编号本身不证明可配对。'
          : '独立设计要求组内观测与两组之间独立，各组分布近似正态；不要求方差相等。'}
      </p>
      {scope && (
        <p className="secondary">
          指标单位、独立观测单位和实验条件来自当前版本的结构化记录；如需修改，请先回到实验页核对口径。
        </p>
      )}
      {Object.entries(labels).map(([key, label]) => (
        <Label key={key} title={label}>
          <Textarea
            aria-label={label}
            rows={key === 'unit' ? 1 : 2}
            value={fields[key as keyof typeof fields]}
            disabled={
              busy ||
              (!!scope && ['unit', 'samplingUnit', 'conditions'].includes(key))
            }
            maxLength={
              key === 'unit'
                ? 120
                : key === 'samplingUnit'
                  ? 500
                  : key === 'conditions'
                    ? 2000
                    : 1500
            }
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
          disabled={busy || !design}
          onChange={(e) => setIndependent(e.target.checked)}
        />
        {design === 'paired'
          ? '我已核对不同配对之间的独立性'
          : '我已核对组内及两组之间的独立性'}
      </label>
      <label>
        <input
          type="checkbox"
          checked={normal}
          disabled={busy || !design}
          onChange={(e) => setNormal(e.target.checked)}
        />
        {design === 'paired'
          ? '我已评估配对差值分布并接受近似正态前提'
          : '我已评估各组分布并接受近似正态前提'}
      </label>
      {design === 'paired' && (
        <>
          <Label title="运行编号配对的依据">
            <Textarea
              aria-label="运行编号配对的依据"
              disabled={busy}
              value={pairingBasis}
              maxLength={1500}
              onChange={(e) => setPairingBasis(e.target.value)}
            />
          </Label>
          <label>
            <input
              type="checkbox"
              disabled={busy}
              checked={pairing}
              onChange={(e) => setPairing(e.target.checked)}
            />
            我已确认相同runId代表可配对的观测；两组编号须完整一致
          </label>
        </>
      )}
      <Picker
        label="选择多重比较方案"
        value={correction}
        disabled={busy}
        onChange={(v) => {
          setCorrection(v);
          setPlanConfirmed(false);
        }}
        options={[
          { value: 'single', label: '仅一个预先指定的比较' },
          { value: 'bonferroni', label: '多次计划比较：Bonferroni校正' },
        ]}
      />
      {correction === 'bonferroni' && (
        <Label title="同一计划中的比较总数（2—100）">
          <Input
            aria-label="比较总数"
            type="number"
            min={2}
            max={100}
            step={1}
            value={count}
            disabled={busy}
            onChange={(e) => {
              setCount(e.target.value);
              setPlanConfirmed(false);
            }}
          />
        </Label>
      )}
      <Label title="比较计划及范围（包含在其他地方执行的相关比较）">
        <Textarea
          aria-label="比较计划及范围"
          value={plan}
          disabled={busy}
          maxLength={2000}
          onChange={(e) => {
            setPlan(e.target.value);
            setPlanConfirmed(false);
          }}
        />
      </Label>
      <label>
        <input
          type="checkbox"
          checked={planConfirmed}
          disabled={busy || !correction}
          onChange={(e) => setPlanConfirmed(e.target.checked)}
        />
        我已核对该计划覆盖相关比较，总数和方案未按结果挑选
      </label>
      <p className="help-text">
        程序记录你的前提和比较计划，不自动验证它们。前提不适用或无法判断时，请保留描述统计；不自动切换检验或删除未配对数据。
      </p>
      <Label title="本次比较说明">
        <Textarea
          aria-label="本次比较说明"
          value={reason}
          disabled={busy}
          maxLength={1200}
          onChange={(e) => setReason(e.target.value)}
        />
      </Label>
      <p>
        <a
          href="https://www.itl.nist.gov/div898/handbook/eda/section3/eda353.htm"
          target="_blank"
          rel="noreferrer"
        >
          方法参考：NIST两组比较
        </a>
      </p>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <Button
        disabled={
          busy ||
          !design ||
          methodA === methodB ||
          !independent ||
          !normal ||
          Object.values(fields).some((v) => !v.trim()) ||
          !correction ||
          !plan.trim() ||
          !planConfirmed ||
          !reason.trim() ||
          !Number.isInteger(selectedCount) ||
          selectedCount < 1 ||
          selectedCount > 100 ||
          (correction === 'bonferroni' && selectedCount < 2) ||
          (design === 'paired' && (!pairing || !pairingBasis.trim()))
        }
        onClick={save}
      >
        计算并保存比较记录
      </Button>
    </Modal>
  );
}
