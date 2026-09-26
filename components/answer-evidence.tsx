'use client';
import { useState } from 'react';
import type { AnswerRecord } from '@/lib/answer-history';
import type { Graph } from '@/lib/graph';
import {
  answerEvidenceMatches,
  type AnswerEvidenceLink,
} from '@/lib/answer-evidence';
import { request, Label } from './common';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

const names = { linked: '已人工关联', stale: '待复查', withdrawn: '已撤回' };
export function AnswerEvidenceControl({
  projectId,
  record,
  sourceIndex,
  sourceStale,
  link,
  onChanged,
}: {
  projectId: string;
  record: AnswerRecord;
  sourceIndex: number;
  sourceStale: boolean;
  link?: AnswerEvidenceLink;
  onChanged: () => Promise<void>;
}) {
  const [snapshot, setSnapshot] = useState<{
    graph: Graph;
    projectRevision: number;
  } | null>(null);
  const [evidenceId, setEvidenceId] = useState(''),
    [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function open() {
    setBusy(true);
    setError('');
    try {
      const data = await request<{ graph: Graph; projectRevision: number }>(
        `/api/projects/${projectId}/graph`,
      );
      setSnapshot(data);
      setReason('');
      const evidence = data.graph.evidence.find((e) =>
        answerEvidenceMatches(record, sourceIndex, e),
      );
      setEvidenceId(evidence ? evidence.id : '');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(action: 'link' | 'withdraw') {
    if (!snapshot) return;
    setBusy(true);
    setError('');
    try {
      await request(`/api/projects/${projectId}/answers`, {
        method: 'PATCH',
        body: JSON.stringify({
          action,
          answerId: record.id,
          sourceIndex,
          evidenceId,
          reason,
          projectRevision: snapshot.projectRevision,
          graphRevision: snapshot.graph.revision,
        }),
      });
      setSnapshot(null);
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      {link && (
        <>
          <p>
            图谱证据：{names[link.status]} · 引用时图谱 v
            {link.source.graphEvidence?.graphRevision}
          </p>
          <small>
            {link.at} · {link.actor} · {link.reason}
          </small>
          <details>
            <summary>图谱关联历史（{link.history.length}）</summary>
            {link.history.toReversed().map((h, i) => (
              <p key={i}>
                {names[h.status]} · 图谱 v
                {h.source.graphEvidence?.graphRevision} · {h.at} · {h.actor} ·{' '}
                {h.reason}
              </p>
            ))}
          </details>
        </>
      )}
      <Button size="sm" variant="outline" disabled={busy} onClick={open}>
        {link ? '核对 / 变更图谱关联' : '关联图谱证据'}
      </Button>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {snapshot && (
        <div className="note">
          <p className="secondary">
            只列出摘录、原文位置和解析内容一致的图谱证据，保存时还会检查当前文献版本。关联不改写旧回答，也不确认回答结论。找不到对应摘录时，请先在图谱核对证据或重新提问。
          </p>
          {sourceStale && (
            <p className="error-text">
              此回答引用旧版原文，请重新提问后关联。已有图谱关联仍可撤回。
            </p>
          )}
          <Label title="对应图谱证据">
            <select
              aria-label="问答对应图谱证据"
              style={{ width: '100%', minWidth: 0 }}
              disabled={busy}
              value={evidenceId}
              onChange={(e) => setEvidenceId(e.target.value)}
            >
              <option value="">请选择一致的证据</option>
              {snapshot.graph.evidence
                .filter((e) => answerEvidenceMatches(record, sourceIndex, e))
                .map((e, i) => (
                  <option key={e.id} value={e.id}>
                    匹配证据 {i + 1}：{e.quote.slice(0, 120)}
                  </option>
                ))}
            </select>
          </Label>
          <Label title="关联核对 / 撤回说明">
            <Textarea
              aria-label="问答图谱关联说明"
              rows={2}
              maxLength={1200}
              disabled={busy}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Label>
          <div className="row">
            <Button
              disabled={busy || sourceStale || !evidenceId || !reason.trim()}
              onClick={() => save('link')}
            >
              保存关联
            </Button>
            {link && link.status !== 'withdrawn' && (
              <Button
                variant="outline"
                disabled={busy || !reason.trim()}
                onClick={() => save('withdraw')}
              >
                撤回关联
              </Button>
            )}
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setSnapshot(null)}
            >
              取消
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
