'use client';
import { useEffect, useState } from 'react';
import type { AnswerRecord } from '@/lib/answer-history';
import type { Project } from '@/lib/domain';
import type { AnswerEvidenceLink } from '@/lib/answer-evidence';
import { AnswerEvidenceControl } from './answer-evidence';
import { Snapshot } from './observations';
import { Modal, request } from './common';
import { Button } from './ui/button';
type Entry = AnswerRecord & {
  graphLinks: AnswerEvidenceLink[];
  status: {
    stalePaperIds: string[];
    contextChanged: boolean;
    needsReview: boolean;
    graphSourceChanged: boolean;
    staleObservationIds: string[];
  };
};
export function AnswerHistory({
  projectId,
  onSource,
  onClose,
  onProject,
}: {
  projectId: string;
  onSource: (paperId: string, blockId?: string) => void;
  onClose: () => void;
  onProject: (project: Project) => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState('');
  async function load(next?: string) {
    setBusy(true);
    setError('');
    try {
      const data = await request<{ records: Entry[]; cursor: string | null }>(
        `/api/projects/${projectId}/answers` +
          (next ? '?cursor=' + encodeURIComponent(next) : ''),
      );
      setEntries((old) =>
        next
          ? [
              ...old,
              ...data.records.filter((r) => !old.some((o) => o.id === r.id)),
            ]
          : data.records,
      );
      setCursor(data.cursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let cancelled = false;
    request<{ records: Entry[]; cursor: string | null }>(
      `/api/projects/${projectId}/answers`,
    )
      .then((data) => {
        if (!cancelled) {
          setEntries(data.records);
          setCursor(data.cursor);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);
  return (
    <Modal
      open
      title="已保存的问答"
      description="保留生成时的回答与摘录，按当前资料检查来源版本。"
      onClose={onClose}
    >
      <p className="secondary">
        记录不自动接续到新对话。原文或课题条件变化后，请重新提问核对；旧回答和模型判断会保留。
      </p>
      <Button variant="outline" disabled={busy} onClick={() => load()}>
        刷新来源状态
      </Button>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {busy && <output>正在读取问答记录…</output>}
      {!busy && !entries.length && !error && (
        <p>暂无已保存问答。此前仅在页面中的对话无法自动恢复。</p>
      )}
      {entries.map((r) => (
        <details
          key={r.id}
          className="note"
          style={{ overflowWrap: 'anywhere' }}
        >
          <summary>
            {r.question} · {r.status.needsReview ? '待复查' : '来源版本一致'}
          </summary>
          <small>
            {new Date(r.at).toLocaleString('zh-CN')} ·{' '}
            {r.model ?? '原文摘录（未调用模型）'}
          </small>
          {r.status.needsReview ? (
            <p className="error-text">
              {r.status.stalePaperIds.length
                ? '引用或检索文献的解析版本已变化。'
                : ''}
              {r.status.contextChanged
                ? '课题条件、笔记、反馈或所选实验观察已变化。'
                : ''}
              {r.status.graphSourceChanged ? '关联图谱证据需要重新核对。' : ''}
              以下为历史结果，需要重新核对。
            </p>
          ) : (
            <p className="secondary">
              版本一致只表示输入未变化，不代表回答正确或经过人工核对。
            </p>
          )}
          <p style={{ whiteSpace: 'pre-wrap' }}>{r.result.answer}</p>
          {!!r.result.statements?.length && (
            <details>
              <summary>生成时的逐项判断</summary>
              {r.result.statements.map((s, i) => (
                <p key={i}>
                  {s.text}
                  {!!s.observationIndices?.length && (
                    <small>
                      {' '}
                      · 用户实验观察{' '}
                      {s.observationIndices.map((i) => i + 1).join('、')}
                    </small>
                  )}
                  <br />
                  {(
                    {
                      supported: '依据支持',
                      partial: '部分支持',
                      conflict: '冲突',
                      unknown: '无法判断',
                    } as Record<string, string>
                  )[s.support] ?? s.support}{' '}
                  · {s.reason}
                </p>
              ))}
            </details>
          )}
          {r.result.sources.map((s, i) => (
            <div key={i}>
              <strong>
                依据 {i + 1} · {s.paperTitle} · 第{s.page}页
              </strong>
              <blockquote style={{ whiteSpace: 'pre-wrap' }}>
                {s.quote}
              </blockquote>
              <AnswerEvidenceControl
                projectId={projectId}
                record={r}
                sourceIndex={i}
                sourceStale={r.status.stalePaperIds.includes(s.paperId)}
                link={r.graphLinks.find((l) => l.sourceIndex === i)}
                onChanged={async () => {
                  const data = await request<{ project: Project }>(
                    `/api/projects/${projectId}`,
                  );
                  onProject(data.project);
                  await load();
                }}
              />
              {r.status.stalePaperIds.includes(s.paperId) ? (
                <p className="error-text">保留旧版摘录；请打开文献重新核对。</p>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onSource(
                    s.paperId,
                    r.status.stalePaperIds.includes(s.paperId)
                      ? undefined
                      : s.blockId,
                  );
                  onClose();
                }}
              >
                {r.status.stalePaperIds.includes(s.paperId)
                  ? '打开当前文献'
                  : '定位当前原文'}
              </Button>
            </div>
          ))}
          {(r.result.observations ?? []).map((ref, i) => (
            <details key={ref.id}>
              <summary>
                用户实验观察 {i + 1} ·{' '}
                {r.status.staleObservationIds.includes(ref.id)
                  ? '旧版快照，待复查'
                  : '引用时版本'}
              </summary>
              <Snapshot value={ref.snapshot} />
            </details>
          ))}
          <details>
            <summary>当时的文献覆盖范围</summary>
            {r.result.coverage.map((c) => (
              <p key={c.paperId}>
                {c.title} · {c.includedBlocks}/{c.totalBlocks} 个片段
                {c.parsing?.qualityWarnings.map((w) => (
                  <span className="error-text" key={w}>
                    ；{w}
                  </span>
                ))}
              </p>
            ))}
          </details>
        </details>
      ))}
      {cursor && (
        <Button disabled={busy} onClick={() => load(cursor)}>
          加载更早记录
        </Button>
      )}
    </Modal>
  );
}
