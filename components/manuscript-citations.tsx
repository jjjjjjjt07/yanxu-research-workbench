'use client';
import { useEffect, useState } from 'react';
import type { Block, Project } from '@/lib/domain';
import {
  citationStatus,
  type ManuscriptCitation,
} from '@/lib/manuscript-citations';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Modal, Label, request } from './common';
const names = {
  linked: '已人工绑定来源',
  stale: '待复查',
  withdrawn: '已撤回',
};

export function ManuscriptCitations({
  project,
  onProject,
  busy,
  dirty,
}: {
  project: Project;
  onProject: (p: Project) => void;
  busy: boolean;
  dirty: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const citations = project.state.review.citations ?? [];
  return (
    <section className="panel" style={{ padding: 24, marginTop: 20 }}>
      <h2>稿件原文引用</h2>
      <p className="secondary">
        将已保存稿件中的原句绑定到文献摘录。原稿或解析版本变化后需重新核对；绑定来源不表示观点已经证实。
      </p>
      <Button
        disabled={
          busy ||
          dirty ||
          !project.state.review.newText.trim() ||
          !project.state.papers.length
        }
        onClick={() => setEditing('new')}
      >
        添加稿件引用
      </Button>
      {dirty && <p className="warning-text">请先保存稿件修改，再核对引用。</p>}
      {!citations.length && <p>尚未绑定原文引用。</p>}
      {citations.map((c) => (
        <div className="note" key={c.id} style={{ overflowWrap: 'anywhere' }}>
          <strong>
            {
              names[
                citationStatus(c, project.state.review, project.state.papers)
              ]
            }
          </strong>
          <p style={{ whiteSpace: 'pre-wrap' }}>稿件原句：{c.text}</p>
          {c.source.graphEvidence && (
            <small>
              图谱证据关联 · 引用时图谱 v{c.source.graphEvidence.graphRevision}
            </small>
          )}
          <p>
            {project.state.papers.find((p) => p.id === c.source.paperId)
              ?.title ?? '原文献不可用'}{' '}
            · 第{c.source.page}页
          </p>
          <blockquote style={{ whiteSpace: 'pre-wrap' }}>
            {c.source.quote}
          </blockquote>
          <small>
            {new Date(c.at).toLocaleString('zh-CN')} · {c.actor} · {c.reason}
          </small>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || dirty}
            onClick={() => setEditing(c.id)}
          >
            核对 / 变更引用
          </Button>
          <details>
            <summary>引用变更历史（{c.history.length}）</summary>
            {c.history.toReversed().map((h, i) => (
              <div key={i}>
                <p>
                  {h.at} · {h.actor} · {h.reason}
                </p>
                <p>
                  此前状态：{names[h.status]} · 稿件原句：{h.binding.text}
                </p>
                <blockquote>{h.binding.source.quote}</blockquote>
              </div>
            ))}
          </details>
        </div>
      ))}
      {editing !== null && (
        <CitationEditor
          key={editing}
          project={project}
          citation={citations.find((c) => c.id === editing)}
          onProject={onProject}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
function CitationEditor({
  project,
  citation,
  onProject,
  onClose,
}: {
  project: Project;
  citation?: ManuscriptCitation;
  onProject: (p: Project) => void;
  onClose: () => void;
}) {
  const priorSource = citation
    ? citation.source
    : { paperId: '', blockId: '', quote: '' };
  const firstPaper = project.state.papers[0];
  const versions = project.state.review.versions || [];
  const currentVersion = versions[versions.length - 1];
  const [openedRevision] = useState(project.revision);
  const [paperId, setPaper] = useState(
    citation ? citation.source.paperId : firstPaper ? firstPaper.id : '',
  );
  const [snapshot, setSnapshot] = useState<{
    blocks: Block[];
    hash: string;
    revision: number;
  } | null>(null);
  const [blockId, setBlock] = useState(''),
    [quote, setQuote] = useState(''),
    [text, setText] = useState(citation ? citation.text : ''),
    [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const root = `/api/projects/${project.id}`,
    paperRoot = `${root}/papers/${paperId}`;
  useEffect(() => {
    let cancelled = false;
    request<{ blocks: Block[]; hash: string; revision: number }>(
      paperRoot + '/parsing',
    )
      .then((s) => {
        if (cancelled) return;
        setSnapshot(s);
        const b =
          s.blocks.find((b) => b.id === priorSource.blockId) ?? s.blocks[0];
        setBlock(b ? b.id : '');
        setQuote(
          priorSource.quote && b && b.text.includes(priorSource.quote)
            ? priorSource.quote
            : b
              ? b.text
              : '',
        );
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [paperRoot, priorSource.blockId, priorSource.quote]);
  const stale =
    openedRevision !== project.revision ||
    (!!snapshot && snapshot.revision !== openedRevision);
  async function save(withdraw = false) {
    if (!withdraw && !snapshot) return;
    setSaving(true);
    setError('');
    try {
      const p = await request<Project>(root, {
        method: 'PATCH',
        body: JSON.stringify({
          action: withdraw
            ? 'review.citation.withdraw'
            : 'review.citation.save',
          id: citation ? citation.id : undefined,
          revision: openedRevision,
          sourceRevision: openedRevision,
          reason,
          ...(withdraw
            ? {}
            : {
                manuscriptVersionId: currentVersion
                  ? currentVersion.id
                  : 'legacy',
                manuscriptText: text,
                paperId,
                blockId,
                quote,
                parseHash: snapshot ? snapshot.hash : undefined,
              }),
        }),
      });
      onProject(p);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal
      open
      title={citation ? '核对稿件引用' : '添加稿件原文引用'}
      description="两端均需是连续原文；请说明摘录如何支持稿件中的表述。"
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {stale && (
        <p className="error-text">课题或资料已变化，请关闭后重新打开。</p>
      )}
      {citation && citation.source.graphEvidence && (
        <p className="secondary">
          重新从原文绑定会解除当前图谱关联，原关联保留在历史中。
        </p>
      )}
      <details>
        <summary>已保存的新稿</summary>
        <p
          style={{ whiteSpace: 'pre-wrap', maxHeight: 180, overflowY: 'auto' }}
        >
          {project.state.review.newText}
        </p>
      </details>
      <Label title="稿件中的原句">
        <Textarea
          aria-label="引用稿件原句"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={3000}
          rows={3}
          disabled={saving}
        />
      </Label>
      <Label title="引用文献">
        <select
          aria-label="稿件引用文献"
          style={{ width: '100%', minWidth: 0 }}
          value={paperId}
          disabled={saving}
          onChange={(e) => {
            setPaper(e.target.value);
            setSnapshot(null);
            setLoading(true);
            setError('');
          }}
        >
          {project.state.papers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </Label>
      {loading ? (
        <output>正在读取原文…</output>
      ) : snapshot && !snapshot.blocks.length ? (
        <p>当前文献没有可引用文字，请先核对 OCR 或补充原文。</p>
      ) : null}
      {snapshot && snapshot.blocks.length > 0 && (
        <>
          <Label title="当前原文片段">
            <select
              aria-label="稿件引用片段"
              style={{ width: '100%', minWidth: 0 }}
              value={blockId}
              disabled={saving}
              onChange={(e) => {
                setBlock(e.target.value);
                setQuote(
                  snapshot.blocks.find((b) => b.id === e.target.value)?.text ??
                    '',
                );
              }}
            >
              {snapshot.blocks.map((b, i) => (
                <option key={b.id} value={b.id}>
                  §{i + 1} · 第{b.page}页 · {b.text.slice(0, 60)}
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
              {snapshot.blocks.find((b) => b.id === blockId)?.text}
            </p>
          </details>
          <a
            href={
              paperRoot +
              '?raw=1#page=' +
              (snapshot.blocks.find((b) => b.id === blockId)?.page ?? 1)
            }
            target="_blank"
            rel="noreferrer"
          >
            打开原文件对照
          </a>
          <Label title="保留的文献摘录">
            <Textarea
              aria-label="稿件引用摘录"
              value={quote}
              onChange={(e) => setQuote(e.target.value)}
              maxLength={6000}
              rows={4}
              disabled={saving}
            />
          </Label>
        </>
      )}
      <Label title="核对说明或撤回原因">
        <Textarea
          aria-label="稿件引用核对说明"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={1200}
          rows={2}
          disabled={saving}
        />
      </Label>
      <Button
        disabled={
          saving ||
          loading ||
          stale ||
          !snapshot ||
          !snapshot.blocks.length ||
          !text.trim() ||
          !quote.trim() ||
          !reason.trim()
        }
        onClick={() => save()}
      >
        保存引用核对记录
      </Button>
      {citation && citation.status !== 'withdrawn' && (
        <Button
          variant="outline"
          disabled={saving || stale || !reason.trim()}
          onClick={() => save(true)}
        >
          撤回引用并保留历史
        </Button>
      )}
      {citation && citation.status === 'withdrawn' && (
        <p className="secondary">重新核对保存会恢复此引用，并保留撤回记录。</p>
      )}
    </Modal>
  );
}
