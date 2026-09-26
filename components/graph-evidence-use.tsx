'use client';
import { useState } from 'react';
import type { Project } from '@/lib/domain';
import type { Evidence } from '@/lib/graph';
import { Modal, Label, request } from './common';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

export function GraphEvidenceUse({
  project,
  evidence,
  graphRevision,
  onSaved,
  onClose,
}: {
  project: Project;
  evidence: Evidence;
  graphRevision: number;
  onSaved: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [projectRevision] = useState(project.revision),
    [revision] = useState(graphRevision);
  const [target, setTarget] = useState<'note' | 'manuscript'>('note'),
    [text, setText] = useState(''),
    [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const stale =
    projectRevision !== project.revision || revision !== graphRevision;
  const lastVersion = (project.state.review.versions || []).at(-1);
  const manuscriptVersionId = lastVersion ? lastVersion.id : 'legacy';
  const paper = project.state.papers.find((p) => p.id === evidence.paperId);
  async function save() {
    setBusy(true);
    setError('');
    try {
      await request(`/api/projects/${project.id}/graph`, {
        method: 'PATCH',
        body: JSON.stringify({
          action: 'evidence.toRecord',
          id: evidence.id,
          target,
          text,
          reason,
          revision,
          projectRevision,
          manuscriptVersionId,
        }),
      });
      await onSaved();
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
      title="引用图谱证据"
      description="创建阅读笔记或稿件引用，保留原文快照和图谱来源。"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p>
        {paper ? paper.title : '原文献不可用'} · 第{evidence.page}页
      </p>
      <blockquote style={{ whiteSpace: 'pre-wrap' }}>
        {evidence.quote}
      </blockquote>
      <a
        href={`/api/projects/${project.id}/papers/${evidence.paperId}?raw=1#page=${evidence.page}`}
        target="_blank"
        rel="noreferrer"
      >
        打开原文核对
      </a>
      <p className="secondary">
        请核对摘录与表述的关系。此操作不确认图谱关系正确；证据纠正或移除后，关联记录会待复查。若摘录与原文不逐字匹配，请先纠正摘录。
      </p>
      <Label title="引用到">
        <select
          aria-label="图谱证据引用目标"
          value={target}
          disabled={busy}
          style={{ width: '100%', minWidth: 0 }}
          onChange={(e) => {
            setTarget(e.target.value as 'note' | 'manuscript');
            setText('');
          }}
        >
          <option value="note">阅读笔记</option>
          <option value="manuscript">稿件引用</option>
        </select>
      </Label>
      {target === 'manuscript' && (
        <details>
          <summary>已保存的新稿</summary>
          <p
            style={{
              whiteSpace: 'pre-wrap',
              maxHeight: 180,
              overflowY: 'auto',
            }}
          >
            {project.state.review.newText || '请先在修改跟踪页保存新稿。'}
          </p>
        </details>
      )}
      <Label title={target === 'note' ? '笔记内容' : '稿件中的唯一原句'}>
        <Textarea
          aria-label="图谱引用表述"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
          maxLength={3000}
          rows={4}
        />
      </Label>
      <Label title="来源核对说明">
        <Textarea
          aria-label="图谱引用核对说明"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
          maxLength={1200}
          rows={2}
        />
      </Label>
      {stale && (
        <p className="error-text">课题或图谱版本已变化，请关闭后重新核对。</p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <Button
        disabled={
          busy ||
          stale ||
          !text.trim() ||
          !reason.trim() ||
          (target === 'manuscript' && !project.state.review.newText.trim())
        }
        onClick={save}
      >
        创建{target === 'note' ? '关联笔记' : '稿件引用'}
      </Button>
    </Modal>
  );
}
