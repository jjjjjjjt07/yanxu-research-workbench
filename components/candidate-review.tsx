'use client';
import { useState } from 'react';
import type { Project, Cell } from '@/lib/domain';
import {
  candidateDifference,
  differenceNames,
  textDifference,
} from '@/lib/candidate-review';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Badge, Label, Modal } from './common';
import type { Mutate } from './literature';

export function CandidateDifference({
  project,
  cell,
}: {
  project: Project;
  cell: Cell;
}) {
  const candidate = cell.candidate,
    delta = candidateDifference(project.state, cell);
  if (!candidate || !delta) return null;
  const diff = textDifference(cell.value, candidate.value);
  return (
    <div className="candidate-difference">
      <div className="row">
        <Badge>{differenceNames[delta.kind]}</Badge>
        {delta.sourceChanged && <Badge>来源变化</Badge>}
        {delta.noteChanged && <Badge>说明或条件变化</Badge>}
      </div>
      <div className="candidate-values">
        <div>
          <strong>当前值</strong>
          <p>
            {diff.prefix}
            <del>{diff.removed}</del>
            {diff.suffix}
            {!cell.value && '（空值）'}
          </p>
        </div>
        <div>
          <strong>新候选</strong>
          <p>
            {diff.prefix}
            <ins>{diff.added}</ins>
            {diff.suffix}
            {!candidate.value && '（未知）'}
          </p>
        </div>
      </div>
      {delta.kind === 'unit' && (
        <p className="secondary">
          仅确定数值与量纲等价；精度、实验条件及含义仍需逐项核对。
        </p>
      )}
      {delta.warnings.length > 0 && (
        <ul className="error-text">
          {delta.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <details>
        <summary>对照原文依据与说明</summary>
        <div className="candidate-values">
          <div>
            <strong>
              当前依据 · {cell.page === null ? '未知页码' : `第${cell.page}页`}
            </strong>
            <blockquote>{cell.quote || '没有已定位摘录'}</blockquote>
            <p>{cell.note || '无说明'}</p>
          </div>
          <div>
            <strong>
              候选依据 ·{' '}
              {candidate.page === null ? '未知页码' : `第${candidate.page}页`}
            </strong>
            <blockquote>{candidate.quote || '没有已定位摘录'}</blockquote>
            <p>{candidate.note || '无说明'}</p>
            {candidate.evidenceRef && (
              <p className="secondary">
                关联图谱证据 · 引用时 v{candidate.evidenceRef.graphRevision} ·{' '}
                {candidate.evidenceRef.id}
              </p>
            )}
          </div>
        </div>
      </details>
    </div>
  );
}

export function CandidateReview({
  project,
  paperIds,
  onClose,
  onCell,
  mutate,
  busy,
}: {
  project: Project;
  paperIds: string[];
  onClose: () => void;
  onCell: (id: string) => void;
  mutate: Mutate;
  busy: boolean;
}) {
  const [snapshot, setSnapshot] = useState(() =>
    structuredClone({ project, paperIds }),
  );
  const [selected, setSelected] = useState<string[]>([]),
    [reason, setReason] = useState(''),
    [historyLimit, setHistoryLimit] = useState(20);
  const cells = snapshot.project.state.cells.filter(
    (c) => c.candidate && snapshot.paperIds.includes(c.paperId),
  );
  const eligible = cells.filter(
    (c) => candidateDifference(snapshot.project.state, c)?.batchAcceptable,
  );
  const selection = cells.filter((c) => selected.includes(c.id));
  const changed = project.revision !== snapshot.project.revision;
  const canAccept =
    selection.length > 0 &&
    selection.every(
      (c) => candidateDifference(snapshot.project.state, c)?.batchAcceptable,
    );
  const history = (project.state.candidateReviews ?? [])
    .filter((r) => snapshot.paperIds.includes(r.paperId))
    .toReversed();
  async function submit(decision: 'accept' | 'retain') {
    if (
      await mutate({
        action: 'candidate.batch',
        ids: selection.map((c) => c.id),
        decision,
        reason,
        reviewRevision: snapshot.project.revision,
      })
    )
      onClose();
  }
  return (
    <Modal
      open
      onClose={onClose}
      wide
      title="候选差异与批量审核"
      description="先核对差异与范围。数值、单位、条件、来源变化或存在警告的候选，必须逐项核对后接受。"
    >
      <p className="secondary">提交时会重新核对原文，检查失败时整批不保存。</p>
      <div className="candidate-review-summary">
        <p>
          当前筛选 {cells.length} 项候选 / 课题{' '}
          {snapshot.project.state.cells.filter((c) => c.candidate).length} 项 ·
          覆盖 {new Set(cells.map((c) => c.paperId)).size} 篇文献
        </p>
        <p>
          可以批量接受 {eligible.length} 项（仅相同内容或排版变化）；已选{' '}
          {selection.length} 项。
        </p>
      </div>
      {changed && (
        <p className="error-text">
          课题在预览后有更新，操作已暂停。请刷新预览后重新选择。
        </p>
      )}
      <div className="row">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            setSnapshot(structuredClone({ project, paperIds }));
            setSelected([]);
          }}
        >
          刷新预览
        </Button>
        <Button
          variant="outline"
          disabled={busy || changed || !eligible.length}
          onClick={() => setSelected(eligible.map((c) => c.id))}
        >
          选择可批量接受的 {eligible.length} 项
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => setSelected([])}>
          清空选择
        </Button>
      </div>
      <div className="candidate-review-list">
        {cells.map((cell) => (
          <article key={cell.id}>
            <label className="candidate-choice">
              <Checkbox
                checked={selected.includes(cell.id)}
                disabled={busy || changed}
                onCheckedChange={(checked) =>
                  setSelected(
                    checked
                      ? [...selected, cell.id]
                      : selected.filter((id) => id !== cell.id),
                  )
                }
              />
              <strong>
                {
                  snapshot.project.state.fields.find(
                    (f) => f.id === cell.fieldId,
                  )?.name
                }{' '}
                ·{' '}
                {
                  snapshot.project.state.papers.find(
                    (p) => p.id === cell.paperId,
                  )?.title
                }
              </strong>
            </label>
            <CandidateDifference project={snapshot.project} cell={cell} />
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                onClose();
                onCell(cell.id);
              }}
            >
              逐项核对与编辑
            </Button>
          </article>
        ))}
      </div>
      {!cells.length && (
        <p className="secondary">当前表格范围没有待处理候选。</p>
      )}
      <Label title="本次审核原因">
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={1800}
          placeholder="记录本次接受或保留的依据"
        />
      </Label>
      <div className="row">
        <Button
          disabled={busy || changed || !canAccept || !reason.trim()}
          onClick={() => submit('accept')}
        >
          接受所选 {selection.length} 项
        </Button>
        <Button
          variant="outline"
          disabled={busy || changed || !selection.length || !reason.trim()}
          onClick={() => submit('retain')}
        >
          保留所选原值（{selection.length} 项）
        </Button>
      </div>
      <details>
        <summary>候选审核记录（{history.length} 条）</summary>
        <div className="candidate-review-history">
          {history.slice(0, historyLimit).map((record) => (
            <article key={record.id}>
              <strong>
                {record.decision === 'accept'
                  ? '接受候选'
                  : record.decision === 'retain'
                    ? '保留原值'
                    : '编辑后核对'}{' '}
                ·{' '}
                {
                  project.state.fields.find((f) => f.id === record.fieldId)
                    ?.name
                }
              </strong>
              <p>
                {
                  project.state.papers.find((p) => p.id === record.paperId)
                    ?.title
                }
              </p>
              <p>
                原值：{record.before.value || '空值'} → 候选：
                {record.candidate.value || '未知'} → 保存：
                {record.after.value || '空值'}
              </p>
              <p>{record.reason}</p>
              <small>
                {record.actor} · {new Date(record.at).toLocaleString('zh-CN')}
              </small>
            </article>
          ))}
        </div>
        {history.length > historyLimit && (
          <Button
            variant="ghost"
            onClick={() => setHistoryLimit((n) => n + 20)}
          >
            查看更多记录
          </Button>
        )}
      </details>
    </Modal>
  );
}
