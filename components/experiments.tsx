'use client';
import { useState } from 'react';
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  LineChart,
  Line,
} from 'recharts';
import {
  Upload,
  Plus,
  Download,
  Link2,
  Check,
  History,
} from 'lucide-react';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  Label,
  Picker,
  Modal,
  Empty,
  Badge,
  statusNames,
  downloadFile,
  request,
} from './common';
import { type Project } from '@/lib/domain';
import { encodeCsvBytes, serializeExperimentCsv } from '@/lib/experiment-csv';
import type { Mutate } from './literature';
import { Observations } from './observations';
import { ExperimentIntervalPanel } from './experiment-interval';
import { ExperimentComparisonPanel } from './experiment-comparison';
import {
  ExperimentStatisticsPanel,
  downloadStatistics,
} from './experiment-statistics';
import {
  ExperimentReproducibility,
  ReproducibilitySummary,
} from './experiment-reproducibility';
import {
  ExperimentScopePanel,
  ExperimentScopeSummary,
} from './experiment-scope';
import { ExperimentArtifacts } from './experiment-artifacts';

const template =
  'method,dataset,metric,value,runId\nMethod-A,Dataset-X,accuracy,89.8,run-1\nMethod-A,Dataset-X,accuracy,90.2,run-2\nMethod-B,Dataset-X,accuracy,91.2,run-1\nMethod-B,Dataset-X,accuracy,90.8,run-2\n';
export function Experiments({
  project,
  onProject,
  mutate,
  busy,
}: {
  project: Project;
  onProject: (p: Project) => void;
  mutate: Mutate;
  busy: boolean;
}) {
  const [selected, setSelected] = useState(''),
    [upload, setUpload] = useState(false),
    [updating, setUpdating] = useState(false),
    [name, setName] = useState(''),
    [csv, setCSV] = useState(''),
    [filename, setFilename] = useState('手动输入.csv'),
    [fileBytes, setFileBytes] = useState<Uint8Array | null>(null),
    [importBusy, setImportBusy] = useState(false),
    [uploadTarget, setUploadTarget] = useState<{
      projectId: string;
      revision: number;
      experimentId?: string;
    } | null>(null),
    [direction, setDirection] = useState('higher'),
    [error, setError] = useState(''),
    [chartType, setChartType] = useState('bar'),
    [dataKey, setDataKey] = useState(''),
    [claimOpen, setClaimOpen] = useState(false),
    [claimText, setClaimText] = useState(''),
    [method, setMethod] = useState(''),
    [other, setOther] = useState(''),
    [relation, setRelation] = useState('higher'),
    [expected, setExpected] = useState('');
  const s = project.state,
    exp = s.experiments.find((e) => e.id === selected) ?? s.experiments[0],
    version = exp?.versions.at(-1),
    rows = version?.rows ?? [];
  const keys = [
    ...new Set(rows.map((r) => JSON.stringify([r.dataset, r.metric]))),
  ];
  const effectiveKey = keys.includes(dataKey) ? dataKey : (keys[0] ?? '[]');
  const [dataset, metric] = JSON.parse(effectiveKey) as string[];
  const plotted = rows.filter(
    (r) => r.dataset === dataset && r.metric === metric,
  );
  const methods = [...new Set(plotted.map((r) => r.method))].map((method) => ({
    value: method,
    label: method,
  }));
  const chartRows = plotted.map((r) => ({
    ...r,
    plotLabel: r.runId ? `${r.method} · ${r.runId}` : r.method,
  }));
  const claims = s.claims.filter((c) => c.experimentId === exp?.id);
  function openUpload(update = false) {
    setUpdating(update);
    setName(update && exp ? exp.name : '新的实验');
    setCSV('');
    setFileBytes(null);
    setUploadTarget({
      projectId: project.id,
      revision: project.revision,
      ...(update && exp ? { experimentId: exp.id } : {}),
    });
    setFilename('手动输入.csv');
    setDirection(update && exp ? exp.direction : 'higher');
    setError('');
    setUpload(true);
  }
  async function saveData() {
    if (!uploadTarget) return;
    setImportBusy(true);
    try {
      setError('');
      const bytes = fileBytes ?? new TextEncoder().encode(csv);
      if (bytes.length > 1_000_000) throw new Error('CSV请控制在1MB内。');
      const saved = await request<Project>(
        `/api/projects/${uploadTarget.projectId}/experiments`,
        {
          method: 'POST',
          body: JSON.stringify({
            revision: uploadTarget.revision,
            id: uploadTarget.experimentId,
            name,
            filename,
            direction,
            origin: fileBytes ? 'file' : 'text',
            base64: encodeCsvBytes(bytes),
          }),
        },
      );
      onProject(saved);
      setSelected(
        uploadTarget.experimentId ?? saved.state.experiments.at(-1)!.id,
      );
      setUpload(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImportBusy(false);
    }
  }
  const Chart = chartType === 'bar' ? BarChart : LineChart;
  return (
    <>
      <div className="toolbar">
        <div className="row">
          <Picker
            label="选择实验"
            value={exp?.id ?? ''}
            options={s.experiments.map((e) => ({ value: e.id, label: e.name }))}
            onChange={(id) => {
              setSelected(id);
              setDataKey('');
            }}
          />
          <span className="secondary">自己的实验数据，与文献结果分开保存</span>
        </div>
        <div className="row">
          <Button
            variant="outline"
            onClick={() =>
              downloadFile(
                '实验数据模板.csv',
                '\uFEFF' + template,
                'text/csv;charset=utf-8',
              )
            }
          >
            <Download />
            CSV 模板
          </Button>
          <Button onClick={() => openUpload()}>
            <Plus />
            导入实验
          </Button>
        </div>
      </div>
      {!exp ? (
        <Empty title="把实验结果与论文描述连起来">
          <p>
            导入自己的实验
            CSV，生成图表，再绑定一条结果描述。数据更新后，相关描述会提示复查。
          </p>
          <Button variant="outline" onClick={() => openUpload()}>
            <Upload />
            导入第一份实验数据
          </Button>
        </Empty>
      ) : (
        <>
          <div className="experiment-grid">
            <section className="panel chart-panel">
              <div className="panel-heading">
                <div>
                  <h2>{exp.name}</h2>
                  <p className="secondary">
                    版本 {exp.versions.length} · {version!.filename}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openUpload(true)}
                >
                  <Upload />
                  更新数据
                </Button>
              </div>
              <div className="row chart-controls">
                <Picker
                  label="数据集与指标"
                  value={effectiveKey}
                  options={keys.map((k) => ({
                    value: k,
                    label: JSON.parse(k).join(' / '),
                  }))}
                  onChange={setDataKey}
                />
                <Picker
                  label="图表类型"
                  value={chartType}
                  options={[
                    { value: 'bar', label: '柱状图' },
                    { value: 'line', label: '折线图' },
                  ]}
                  onChange={setChartType}
                />
                <Badge>
                  {exp.direction === 'higher' ? '越大越好' : '越小越好'}
                </Badge>
              </div>
              <ChartContainer
                config={{
                  value: { label: metric ?? '指标值', color: '#426cdd' },
                }}
                className="experiment-chart"
              >
                <Chart
                  data={chartRows}
                  margin={{ top: 15, right: 20, left: 0, bottom: 10 }}
                >
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="plotLabel"
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    domain={['auto', 'auto']}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  {chartType === 'bar' ? (
                    <Bar
                      dataKey="value"
                      fill="#426cdd"
                      radius={[5, 5, 0, 0]}
                      maxBarSize={64}
                    />
                  ) : (
                    <Line
                      dataKey="value"
                      stroke="#426cdd"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                    />
                  )}
                </Chart>
              </ChartContainer>
              <p className="help-text">
                图中显示每次运行的原值，汇总见下方统计。仅比较当前数据集与指标；现有描述核对只支持唯一数值，多次运行不自动采用首行或均值。
              </p>
            </section>
            <section className="panel linked-panel">
              <div className="panel-heading">
                <h2>
                  <Link2 size={19} />
                  关联描述
                </h2>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setClaimText('');
                    setMethod(plotted[0]?.method ?? '');
                    setOther(methods[1]?.value ?? '');
                    setRelation(exp.direction);
                    setExpected('');
                    setClaimOpen(true);
                  }}
                >
                  <Plus />
                  添加
                </Button>
              </div>
              {!claims.length ? (
                <div className="mini-empty">
                  选中一个数据关系，绑定你想核对的论文句子。
                </div>
              ) : (
                claims.map((c) => (
                  <div
                    className={`claim-card ${c.needsReview ? 'needs-review' : ''}`}
                    key={c.id}
                  >
                    <div className="row">
                      <Badge kind={c.result}>{statusNames[c.result]}</Badge>
                      {c.needsReview && <Badge kind="stale">数据已更新</Badge>}
                    </div>
                    <p>{c.text}</p>
                    <small>{c.detail}</small>
                    <div className="row">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || c.result !== 'pass' || !c.needsReview}
                        onClick={() =>
                          mutate({ action: 'claim.confirm', id: c.id })
                        }
                      >
                        <Check />
                        确认已复查
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          mutate({ action: 'claim.remove', id: c.id })
                        }
                      >
                        解除关联
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </section>
          </div>
          <div className="experiment-grid bottom-grid">
            <section className="panel">
              <div className="panel-heading">
                <h3>当前数据</h3>
                <span className="secondary">{rows.length} 条记录</span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>方法</TableHead>
                    <TableHead>运行编号</TableHead>
                    <TableHead>数据集</TableHead>
                    <TableHead>指标</TableHead>
                    <TableHead>数值</TableHead>
                    <TableHead>来源行</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 100).map((r, i) => (
                    <TableRow key={i}>
                      <TableCell>{r.method}</TableCell>
                      <TableCell>{r.runId ?? '未编号'}</TableCell>
                      <TableCell>{r.dataset}</TableCell>
                      <TableCell>{r.metric}</TableCell>
                      <TableCell className="mono">{r.value}</TableCell>
                      <TableCell>
                        {version?.csvSource?.lineRanges[i]?.join('—') ??
                          '未留存'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {rows.length > 100 && (
                <p className="help-text padded">
                  仅预览前 100 行，全部数据均参与计算。
                </p>
              )}
            </section>
            <section className="panel">
              <div className="panel-heading">
                <h3>
                  <History size={17} />
                  数据版本
                </h3>
              </div>
              {exp.versions.toReversed().map((v, i) => (
                <div className="version-item" key={v.id}>
                  <span className="version-number">
                    V{exp.versions.length - i}
                  </span>
                  <div>
                    <strong>{v.filename}</strong>
                    <small>
                      {new Date(v.at).toLocaleString('zh-CN')} · {v.rows.length}{' '}
                      行
                    </small>
                    <ReproducibilitySummary record={v.reproducibility} />
                    <ExperimentScopeSummary record={v.scope} rows={v.rows} />
                    {v.statistics && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => downloadStatistics(exp, v)}
                      >
                        下载本版本统计记录
                      </Button>
                    )}
                    {v.csvSource ? (
                      <details style={{ overflowWrap: 'anywhere' }}>
                        <summary>
                          {v.csvSource.origin === 'file'
                            ? '上传原件已留存'
                            : '手动 / 编辑文本已留存'}
                        </summary>
                        <p>
                          {v.csvSource.size} 字节 · SHA-256：
                          {v.csvSource.sha256}
                        </p>
                        <a
                          href={`/api/projects/${project.id}/experiments?experimentId=${encodeURIComponent(exp.id)}&versionId=${encodeURIComponent(v.id)}`}
                          download
                        >
                          下载
                          {v.csvSource.origin === 'file'
                            ? '上传原件'
                            : '导入文本'}
                        </a>
                      </details>
                    ) : (
                      <small>旧版本未留存CSV原件</small>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      downloadFile(
                        `${exp.name}-v${exp.versions.length - i}.csv`,
                        '\uFEFF' + serializeExperimentCsv(v.rows),
                        'text/csv;charset=utf-8',
                      )
                    }
                    aria-label="下载此版本的规范数据（重新生成CSV）"
                    title="下载规范数据（重新生成CSV）"
                  >
                    <Download size={16} />
                  </Button>
                </div>
              ))}
            </section>
          </div>
        </>
      )}
      {exp && (
        <ExperimentScopePanel
          project={project}
          experiment={exp}
          onProject={onProject}
        />
      )}
      {exp && (
        <ExperimentStatisticsPanel
          experiment={exp}
          dataset={dataset}
          metric={metric}
        />
      )}
      {exp && (
        <ExperimentIntervalPanel
          project={project}
          experiment={exp}
          dataset={dataset}
          metric={metric}
          onProject={onProject}
        />
      )}
      {exp && (
        <ExperimentComparisonPanel
          project={project}
          experiment={exp}
          dataset={dataset}
          metric={metric}
          onProject={onProject}
        />
      )}
      {exp && (
        <ExperimentReproducibility
          project={project}
          experiment={exp}
          onProject={onProject}
        />
      )}
      {exp && (
        <ExperimentArtifacts
          project={project}
          experiment={exp}
          onProject={onProject}
        />
      )}
      {exp && (
        <Observations
          project={project}
          onProject={onProject}
          experimentId={exp.id}
        />
      )}
      <Modal
        open={upload}
        onClose={() => {
          if (!importBusy) setUpload(false);
        }}
        title={updating ? '更新实验数据' : '导入实验数据'}
        description="UTF-8、逗号分隔；必需列：method、dataset、metric、value。同一组多次运行时增加runId列，每次运行编号不同。"
        wide
      >
        <Label title="实验名称">
          <Input
            value={name}
            disabled={importBusy}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
          />
        </Label>
        <div className="row">
          <input
            aria-label="上传实验 CSV"
            type="file"
            accept=".csv"
            disabled={importBusy}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) {
                setImportBusy(true);
                setError('');
                try {
                  if (f.size > 1_000_000) {
                    throw new Error('CSV请控制在1MB内。');
                  }
                  const bytes = new Uint8Array(await f.arrayBuffer());
                  const text = new TextDecoder('utf-8', { fatal: true }).decode(
                    bytes,
                  );
                  setCSV(text);
                  setFileBytes(bytes);
                  setFilename(f.name);
                } catch {
                  setCSV('');
                  setFileBytes(null);
                  setFilename('手动输入.csv');
                  setError('无法读取文件，请选择1MB以内的UTF-8 CSV。');
                } finally {
                  setImportBusy(false);
                }
              }
            }}
          />
        </div>
        <Label title="CSV 内容">
          <Textarea
            className="mono"
            rows={9}
            value={csv}
            disabled={importBusy}
            onChange={(e) => {
              setCSV(e.target.value);
              setFileBytes(null);
              setFilename('手动输入.csv');
            }}
            placeholder={template}
          />
        </Label>
        <p className="help-text">
          {fileBytes
            ? '保存上传原件的完整字节。编辑上方内容后，将改为保存编辑文本。'
            : '保存当前文本；不标记为上传原件。'}{' '}
          空白记录不进入计算；来源行包含表头和空行，带换行的字段可跨多行。
        </p>
        <Label title="指标比较方向">
          <Picker
            value={direction}
            onChange={setDirection}
            label="选择比较方向"
            options={[
              { value: 'higher', label: '数值越大越好' },
              { value: 'lower', label: '数值越小越好' },
            ]}
          />
        </Label>
        {error && <p className="error-text">{error}</p>}
        <div className="dialog-actions">
          <Button
            variant="outline"
            disabled={importBusy}
            onClick={() => setUpload(false)}
          >
            取消
          </Button>
          <Button
            disabled={busy || importBusy || !name.trim() || !csv.trim()}
            onClick={saveData}
          >
            校验并保存
          </Button>
        </div>
      </Modal>
      <Modal
        open={claimOpen}
        onClose={() => setClaimOpen(false)}
        title="关联结果描述"
        description={`当前比较范围：${dataset ?? ''} / ${metric ?? ''}`}
      >
        <Label title="论文中的句子">
          <Textarea
            value={claimText}
            onChange={(e) => setClaimText(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="例如：方法 A 的准确率高于方法 B。"
          />
        </Label>
        <Label title="方法">
          <Picker
            label="选择方法"
            value={method}
            onChange={setMethod}
            options={methods}
          />
        </Label>
        <Label title="要检查的数据关系">
          <Picker
            label="选择关系"
            value={relation}
            onChange={setRelation}
            options={[
              { value: 'higher', label: '高于另一方法' },
              { value: 'lower', label: '低于另一方法' },
              { value: 'equal', label: '等于另一方法' },
              { value: 'number', label: '等于指定数值' },
            ]}
          />
        </Label>
        {relation === 'number' ? (
          <Label title="句子中的数值">
            <Input
              type="number"
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
            />
          </Label>
        ) : (
          <Label title="对照方法">
            <Picker
              label="选择对照方法"
              value={other}
              onChange={setOther}
              options={methods}
            />
          </Label>
        )}
        <p className="help-text">
          系统核对你指定的数据关系。请确认这与句子的实际含义一致。
        </p>
        <Button
          disabled={
            busy ||
            !claimText.trim() ||
            !method ||
            (relation === 'number' ? !expected : !other)
          }
          onClick={async () => {
            if (
              await mutate({
                action: 'claim.add',
                text: claimText,
                experimentId: exp!.id,
                method,
                otherMethod: other,
                dataset,
                metric,
                relation,
                expected: relation === 'number' ? Number(expected) : null,
              })
            )
              setClaimOpen(false);
          }}
        >
          建立关联
        </Button>
      </Modal>
    </>
  );
}
