'use client';
import { useMemo } from 'react';
import type { Experiment } from '@/lib/domain';
import { summarizeExperiment } from '@/lib/experiment-statistics';
import { Button } from './ui/button';
import { downloadFile } from './common';

const display = (n: number | null) =>
  n === null ? '未计算' : String(Number(n.toPrecision(8)));
export function downloadStatistics(
  experiment: Experiment,
  version: Experiment['versions'][number],
) {
  downloadFile(
    `${experiment.name}-${version.id}-统计记录.json`,
    JSON.stringify(
      {
        experimentId: experiment.id,
        versionId: version.id,
        filename: version.filename,
        csvSource: version.csvSource,
        rows: version.rows,
        statistics: version.statistics,
      },
      null,
      2,
    ),
    'application/json',
  );
}
export function ExperimentStatisticsPanel({
  experiment,
  dataset,
  metric,
}: {
  experiment: Experiment;
  dataset: string;
  metric: string;
}) {
  const version = experiment.versions.at(-1)!;
  const groups = useMemo(
    () => version.statistics?.groups ?? summarizeExperiment(version.rows),
    [version],
  );
  const selected = groups.filter(
    (g) => g.dataset === dataset && g.metric === metric,
  );
  return (
    <section className="panel" style={{ padding: 24, marginTop: 20 }}>
      <div
        className="panel-heading"
        style={{ flexWrap: 'wrap', padding: 0, marginBottom: 12 }}
      >
        <h3>运行记录统计</h3>
        {version.statistics && (
          <Button
            variant="outline"
            onClick={() => downloadStatistics(experiment, version)}
          >
            下载本版本完整计算记录
          </Button>
        )}
      </div>
      <p>
        {dataset} / {metric} ·
        按方法分组。n为导入的运行记录数，不是训练/测试样本数。
      </p>
      <div
        style={{ overflowX: 'auto' }}
        role="region"
        aria-label="运行记录统计表，可横向滚动"
        tabIndex={0}
      >
        <table className="experiment-summary-table" style={{ minWidth: 560 }}>
          <thead>
            <tr>
              <th>方法</th>
              <th>n</th>
              <th>均值</th>
              <th>样本标准差</th>
              <th>最小值</th>
              <th>最大值</th>
            </tr>
          </thead>
          <tbody>
            {selected.map((g) => (
              <tr key={g.method}>
                <td>{g.method}</td>
                <td>{g.n}</td>
                <td>{display(g.mean)}</td>
                <td>
                  {g.issue === 'single_value'
                    ? '仅1次，无法计算'
                    : g.issue === 'numeric_range'
                      ? '数值超出计算范围'
                      : display(g.sampleSD)}
                </td>
                <td>{display(g.min)}</td>
                <td>{display(g.max)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="help-text">
        同组记录须使用一致的单位和实验条件；不同条件请另建实验或区分数据集/指标。重复运行编号不证明运行相互独立。这里只描述已导入数值，不判断统计显著性。
      </p>
      <details>
        <summary>计算方法与输入</summary>
        <p>
          均值 = Σx/n；样本标准差 =
          √[Σ(x−均值)²/(n−1)]。不删除异常值，不填补缺失值。表中保留8位有效数字，计算记录保存未显示舍入的数值。
        </p>
        <p>
          <a
            href="https://www.itl.nist.gov/div898/handbook/eda/section3/eda356.htm"
            target="_blank"
            rel="noreferrer"
          >
            标准差公式参考：NIST统计手册
          </a>
        </p>
        {version.statistics ? (
          <p style={{ overflowWrap: 'anywhere' }}>
            已保存计算：{version.statistics.computedAt} · 输入数据SHA-256：
            {version.statistics.inputDataHash}
          </p>
        ) : (
          <p>旧版本即时预览；此前没有保存计算记录，原版本保持不变。</p>
        )}
        {selected.map((g) => (
          <p key={g.method} style={{ overflowWrap: 'anywhere' }}>
            {g.method} · 数据行：{g.indices.map((i) => i + 1).join('、')} ·
            运行编号：{g.runIds.map((id) => id ?? '未编号').join('、')}
          </p>
        ))}
      </details>
    </section>
  );
}
