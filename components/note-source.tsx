'use client';
import { useEffect, useState } from 'react';
import type { Block, Project } from '@/lib/domain';
import type { ReadingNote } from '@/lib/source-reference';
import { Modal, Label, request } from './common';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

export function NoteSource({
  project,
  note,
  onProject,
  onClose,
}: {
  project: Project;
  note: ReadingNote;
  onProject: (p: Project) => void;
  onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState<{
    blocks: Block[];
    hash: string;
    revision: number;
  } | null>(null);
  const [blockId, setBlockId] = useState(''),
    [quote, setQuote] = useState(''),
    [reason, setReason] = useState('');
  const [busy, setBusy] = useState(true),
    [error, setError] = useState('');
  const root = `/api/projects/${project.id}`,
    sourceUrl = `${root}/papers/${note.paperId}`;
  useEffect(() => {
    let cancelled = false;
    request<{ blocks: Block[]; hash: string; revision: number }>(
      sourceUrl + '/parsing',
    )
      .then((s) => {
        if (cancelled) return;
        setSnapshot(s);
        const block =
          s.blocks.find((b) => b.id === note.blockId) ?? s.blocks[0];
        setBlockId(block?.id ?? '');
        setQuote(
          note.source?.quote && block?.text.includes(note.source.quote)
            ? note.source.quote
            : (block?.text ?? ''),
        );
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
  }, [sourceUrl, note.blockId, note.source?.quote]);
  async function save() {
    if (!snapshot) return;
    setBusy(true);
    setError('');
    try {
      const p = await request<Project>(root, {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'note.source',
          id: note.id,
          revision: snapshot.revision,
          parseHash: snapshot.hash,
          blockId,
          quote,
          reason,
        }),
      });
      onProject(p);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const selected = snapshot?.blocks.find((b) => b.id === blockId);
  return (
    <Modal
      open
      title="核对笔记原文来源"
      description={
        project.state.papers.find((p) => p.id === note.paperId)?.title
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p style={{ whiteSpace: 'pre-wrap' }}>{note.text}</p>
      <p className="secondary">
        选择当前解析片段，对照原文件并填写核对说明。保存只更新来源绑定，保留笔记正文和旧来源记录；这不表示笔记结论已被证实。
      </p>
      {note.source ? (
        <details>
          <summary>此前绑定的摘录 · 第 {note.source.page} 页</summary>
          <p style={{ whiteSpace: 'pre-wrap' }}>{note.source.quote}</p>
          {note.source.graphEvidence && (
            <p className="secondary">
              引用时图谱 v{note.source.graphEvidence.graphRevision}
              。重新从原文绑定会解除当前图谱关联，原关联保留在历史中。
            </p>
          )}
          <small style={{ overflowWrap: 'anywhere' }}>
            解析版本：{note.source.parseVersionId} ·{' '}
            {note.source.review
              ? '有人工来源核对记录'
              : '保存笔记时绑定，尚未人工核对'}
          </small>
          {note.source.review && (
            <p className="secondary">
              {note.source.review.at} · {note.source.review.actor} ·{' '}
              {note.source.review.reason}
            </p>
          )}
        </details>
      ) : (
        <p className="secondary">
          {note.blockId
            ? '旧笔记没有原文快照，无法还原当时的摘录；请重新选择依据。'
            : '这条笔记尚未绑定片段，可选择原文为个人观察补充依据。'}
        </p>
      )}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {snapshot && snapshot.revision !== project.revision && (
        <p className="error-text">课题已更新，请关闭后重新核对。</p>
      )}
      {!snapshot ? (
        <p>正在读取当前解析…</p>
      ) : !snapshot.blocks.length ? (
        <p>当前文献没有可引用文字，请先在阅读页完成 OCR 或补充原文。</p>
      ) : (
        <>
          <Label title="当前原文片段">
            <select
              style={{ width: '100%', minWidth: 0 }}
              aria-label="笔记来源片段"
              value={blockId}
              disabled={busy}
              onChange={(e) => {
                setBlockId(e.target.value);
                setQuote(
                  snapshot.blocks.find((b) => b.id === e.target.value)?.text ??
                    '',
                );
              }}
            >
              {snapshot.blocks.map((b, i) => (
                <option key={b.id} value={b.id}>
                  §{i + 1} · 第{b.page}页 · {b.text.slice(0, 65)}
                </option>
              ))}
            </select>
          </Label>
          <details open>
            <summary>当前片段全文</summary>
            <p
              style={{
                whiteSpace: 'pre-wrap',
                maxHeight: 180,
                overflowY: 'auto',
              }}
            >
              {selected?.text}
            </p>
          </details>
          <a
            href={sourceUrl + '?raw=1#page=' + (selected?.page ?? 1)}
            target="_blank"
            rel="noreferrer"
          >
            打开原始文件对照
          </a>
          <Label title="保留的原文摘录">
            <Textarea
              aria-label="笔记来源摘录"
              value={quote}
              onChange={(e) => setQuote(e.target.value)}
              disabled={busy}
              maxLength={6000}
              rows={4}
            />
          </Label>
          <Label title="来源核对说明">
            <Textarea
              aria-label="笔记来源核对说明"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
              maxLength={1200}
              rows={2}
            />
          </Label>
          <Button
            disabled={
              busy ||
              !quote.trim() ||
              !reason.trim() ||
              snapshot.revision !== project.revision
            }
            onClick={save}
          >
            保存来源核对记录
          </Button>
        </>
      )}
      {!!note.sourceHistory?.length && (
        <details>
          <summary>来源变更历史（{note.sourceHistory.length}）</summary>
          {note.sourceHistory.toReversed().map((h, i) => (
            <div key={i}>
              <p>
                {h.at} · {h.actor} · {h.reason}
              </p>
              <p className="secondary">
                此前来源：
                {h.source
                  ? `第${h.source.page}页 · ${h.sourceNeedsReview ? '待复查' : '原绑定'}`
                  : '无原文快照'}
              </p>
              <p style={{ whiteSpace: 'pre-wrap' }}>{h.source?.quote}</p>
            </div>
          ))}
        </details>
      )}
    </Modal>
  );
}
