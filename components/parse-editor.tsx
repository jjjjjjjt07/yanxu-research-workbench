'use client';
import { useEffect, useState } from 'react';
import type { Block, Paper, Project } from '@/lib/domain';
import type { ParseVersion } from '@/lib/parse-versions';
import { Modal, Label, request } from './common';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
type Snapshot = {
  blocks: Block[];
  versions: ParseVersion[];
  revision: number;
  hash: string;
  currentVersionId: string;
};
export function ParseEditor({
  project,
  paper,
  active,
  onProject,
  onClose,
}: {
  project: Project;
  paper: Paper;
  active: string;
  onProject: (p: Project) => void;
  onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [blocks, setBlocks] = useState<Block[]>([]);
  const [versionId, setVersionId] = useState(''),
    [blockId, setBlockId] = useState(active),
    [text, setText] = useState(''),
    [reason, setReason] = useState('');
  const [busy, setBusy] = useState(true),
    [error, setError] = useState('');
  const url = `/api/projects/${project.id}/papers/${paper.id}/parsing`;
  useEffect(() => {
    let cancelled = false;
    request<Snapshot>(url)
      .then((data) => {
        if (cancelled) return;
        setSnapshot(data);
        setBlocks(data.blocks);
        setVersionId(data.currentVersionId);
        const block =
          data.blocks.find((b) => b.id === active) ?? data.blocks[0];
        setBlockId(block?.id ?? '');
        setText(block?.text ?? '');
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
  }, [url, active]);
  const historical = snapshot && versionId !== snapshot.currentVersionId;
  const stale = snapshot && snapshot.revision !== project.revision;
  const selectedVersion = snapshot?.versions.find((v) => v.id === versionId);
  async function selectVersion(id: string) {
    setBusy(true);
    setError('');
    try {
      const data = await request<Snapshot>(
        url + '?version=' + encodeURIComponent(id),
      );
      if (data.hash !== snapshot?.hash || data.revision !== snapshot.revision)
        throw new Error('资料已更新，请关闭窗口后重新打开。');
      setVersionId(id);
      setBlocks(data.blocks);
      setReason('');
      const block = data.blocks.find((b) => b.id === blockId) ?? data.blocks[0];
      setBlockId(block?.id ?? '');
      setText(block?.text ?? '');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!snapshot) return;
    setBusy(true);
    setError('');
    try {
      const result = await request<{ project: Project; unchanged?: boolean }>(
        url,
        {
          method: 'PATCH',
          body: JSON.stringify({
            action: historical ? 'restore' : 'correct',
            revision: snapshot.revision,
            hash: snapshot.hash,
            blockId,
            ...(historical ? {} : { text }),
            versionId,
            reason,
          }),
        },
      );
      onProject(result.project);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="解析文本纠错与版本"
      description={paper.title}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="secondary">
        仅修正解析文字，原始文件和位置框保留。请对照原文，不要改写论文结论。保存会使该文献的表格来源、相关图谱关系和引用笔记待复查，并取消课题未完成的旧输入任务。
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {stale && (
        <p className="error-text">课题已更新，请关闭窗口后重新打开。</p>
      )}
      {!snapshot ? (
        <p>正在读取解析版本…</p>
      ) : (
        <>
          <Label title="解析版本">
            <select
              aria-label="解析版本"
              disabled={busy}
              value={versionId}
              onChange={(e) => selectVersion(e.target.value)}
            >
              {snapshot.versions.map((v, i) => (
                <option key={v.id} value={v.id}>
                  v{i + 1} ·{' '}
                  {v.id === snapshot.currentVersionId ? '当前 · ' : ''}
                  {v.reason}
                </option>
              ))}
            </select>
          </Label>
          <p className="secondary">
            {selectedVersion?.at ?? '原时间未知'} ·{' '}
            {selectedVersion?.actor ?? '原操作者未知'}
          </p>
          <Label title="原文片段">
            <select
              aria-label="原文片段"
              disabled={busy}
              value={blockId}
              onChange={(e) => {
                setBlockId(e.target.value);
                setText(
                  blocks.find((b) => b.id === e.target.value)?.text ?? '',
                );
              }}
            >
              {blocks.map((b, i) => (
                <option key={b.id} value={b.id}>
                  §{i + 1} · 第{b.page}页 · {b.text.slice(0, 55)}
                </option>
              ))}
            </select>
          </Label>
          {!historical && (
            <details>
              <summary>保存前的解析文字</summary>
              <p style={{ whiteSpace: 'pre-wrap' }}>
                {blocks.find((b) => b.id === blockId)?.text}
              </p>
            </details>
          )}
          <Label
            title={historical ? '历史解析文字（只读）' : '修正后的解析文字'}
          >
            <Textarea
              aria-label="解析文字"
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={busy}
              readOnly={!!historical}
              rows={8}
              maxLength={6000}
            />
          </Label>
          <Label title="修改或恢复原因">
            <Textarea
              aria-label="修改或恢复原因"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
              maxLength={1200}
              rows={2}
            />
          </Label>
          {historical && (
            <p className="secondary">
              将恢复所选版本的全部片段并追加版本，已有核对状态不会自动恢复。
            </p>
          )}
          <Button
            disabled={
              busy ||
              !!stale ||
              !reason.trim() ||
              (!historical && !text.trim()) ||
              (!historical &&
                text === blocks.find((b) => b.id === blockId)?.text)
            }
            onClick={save}
          >
            {historical ? '恢复此版本并记录原因' : '保存纠错版本'}
          </Button>
        </>
      )}
    </Modal>
  );
}
