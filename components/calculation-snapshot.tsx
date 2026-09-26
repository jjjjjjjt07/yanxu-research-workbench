'use client';
import type { CalculationReference } from '@/lib/calculation-reference';
import { IntervalResult } from './experiment-interval';
import { ComparisonResult } from './experiment-comparison';

export function calculationLabel(ref: CalculationReference) {
  const r = ref.record;
  return `${ref.kind === 'interval' ? `${ref.record.method} 均值95%区间` : `${ref.record.sampleA.method}−${ref.record.sampleB.method} ${ref.record.design === 'paired' ? '配对t' : 'Welch'}`} · ${r.dataset}/${r.metric} · ${r.at}`;
}
export function CalculationSnapshot({
  value,
}: {
  value: CalculationReference;
}) {
  return (
    <details>
      <summary>计算依据：{calculationLabel(value)}</summary>
      <p className="help-text">
        以下是引用时保存的计算及前提，不自动证明人工解释、因果关系或独立复现。新数据需要重新计算和核对引用。
      </p>
      {value.kind === 'interval' ? (
        <IntervalResult record={value.record} />
      ) : (
        <ComparisonResult record={value.record} />
      )}
    </details>
  );
}
