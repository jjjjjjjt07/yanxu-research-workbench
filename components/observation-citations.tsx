'use client';
import { useState } from 'react';
import type { Project } from '@/lib/domain';
import type { Graph } from '@/lib/graph';
import {
  observationCitationStatus,
  type ObservationCitation,
} from '@/lib/observation-citations';
import { observationCurrent } from '@/lib/observation-reference';
import { Snapshot } from './observations';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Modal, Label, request } from './common';
const names = { linked: '已人工绑定', stale: '待复查', withdrawn: '已撤回' };
export function ObservationCitations({
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
  const [editing, setEditing] = useState<{
    project: Project;
    graph: Graph;
    citation?: ObservationCitation;
  } | null>(null);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  async function open(citation?: ObservationCitation) {
    setLoading(true);
    setError('');
    try {
      const data = await request<{ graph: Graph; projectRevision: number }>(
        `/api/projects/${project.id}/graph`,
      );
      if (data.projectRevision !== project.revision)
        throw new Error('课题已更新，请刷新后重新核对。');
      setEditing({ project, graph: data.graph, citation });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  return (
    <section className="panel" style={{ padding: 24, marginTop: 20 }}>
      <h2>稿件实验观察引用</h2>
      <p className="secondary">
        将稿件原句绑定到自己的实验观察，保留原始数据、所附计算和统计前提快照。计算复核不代表前提已被证实，也不自动证明稿件结论。
      </p>
      <Button
        disabled={
          busy ||
          dirty ||
          loading ||
          !project.state.review.newText.trim() ||
          !project.state.observations?.some((o) =>
            observationCurrent(project.state, o),
          )
        }
        onClick={() => open()}
      >
        引用实验观察
      </Button>
      {dirty && <p className="warning-text">请先保存稿件修改，再核对引用。</p>}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {(project.state.review.observationCitations ?? []).map((c) => (
        <details key={c.id} className="note">
          <summary>
            {names[observationCitationStatus(project.state, c)]} ·{' '}
            {c.text.slice(0, 100)}
          </summary>
          <p>稿件原句：{c.text}</p>
          <Snapshot value={c.source.snapshot} />
          <small>
            引用核对：{c.at} · {c.actor} · {c.reason}
          </small>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || dirty || loading}
            onClick={() => open(c)}
          >
            核对 / 变更实验引用
          </Button>
          <details>
            <summary>引用变更历史（{c.history.length}）</summary>
            {c.history.toReversed().map((h, i) => (
              <div key={i}>
                <p>
                  {names[h.status]} · {h.text} · {h.at} · {h.reason}
                </p>
                <Snapshot value={h.source.snapshot} />
              </div>
            ))}
          </details>
        </details>
      ))}
      {editing && (
        <Editor
          project={editing.project}
          graph={editing.graph}
          citation={editing.citation}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            onProject(p);
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}
function Editor({
  project,
  graph,
  citation,
  onSaved,
  onClose,
}: {
  project: Project;
  graph: Graph;
  citation?: ObservationCitation;
  onSaved: (p: Project) => void;
  onClose: () => void;
}) {
  const choices = (project.state.observations ?? []).filter((o) =>
    observationCurrent(project.state, o),
  );
  const [observationId, setObservationId] = useState(
    citation ? citation.source.id : choices[0] ? choices[0].id : '',
  );
  const [text, setText] = useState(citation ? citation.text : ''),
    [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const chosen = choices.find((o) => o.id === observationId);
  const last = (project.state.review.versions || []).at(-1);
  async function save(action: 'cite' | 'citation.withdraw') {
    setBusy(true);
    setError('');
    try {
      const data = await request<{ project: Project }>(
        `/api/projects/${project.id}/observations`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            action,
            id: citation ? citation.id : undefined,
            observationId,
            text,
            reason,
            projectRevision: project.revision,
            graphRevision: graph.revision,
            manuscriptVersionId: last ? last.id : 'legacy',
          }),
        },
      );
      onSaved(data.project);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="核对稿件实验引用"
      description="引用已保存的稿件原句，绑定当前可用实验观察。"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {citation && (
        <details>
          <summary>此前引用的观察快照</summary>
          <Snapshot value={citation.source.snapshot} />
        </details>
      )}
      <details>
        <summary>已保存的新稿</summary>
        <p
          style={{ whiteSpace: 'pre-wrap', maxHeight: 180, overflowY: 'auto' }}
        >
          {project.state.review.newText}
        </p>
      </details>
      <Label title="稿件中的唯一连续原句">
        <Textarea
          aria-label="实验引用稿件原句"
          value={text}
          disabled={busy}
          maxLength={3000}
          rows={3}
          onChange={(e) => setText(e.target.value)}
        />
      </Label>
      <Label title="实验观察">
        <select
          aria-label="稿件引用的实验观察"
          value={observationId}
          disabled={busy}
          style={{ width: '100%' }}
          onChange={(e) => setObservationId(e.target.value)}
        >
          <option value="">请选择已核对的当前观察</option>
          {choices.map((o) => (
            <option key={o.id} value={o.id}>
              {o.text.slice(0, 100)}
            </option>
          ))}
        </select>
      </Label>
      {chosen ? (
        <details open>
          <summary>当前观察及数据</summary>
          <Snapshot value={chosen} />
        </details>
      ) : (
        <p className="secondary">
          原观察可能已撤回或待复查，请先在实验页核对；已有引用仍可撤回。
        </p>
      )}
      <Label title="核对 / 撤回说明">
        <Textarea
          aria-label="稿件实验引用说明"
          rows={2}
          maxLength={1200}
          value={reason}
          disabled={busy}
          onChange={(e) => setReason(e.target.value)}
        />
      </Label>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <Button
          disabled={busy || !chosen || !text.trim() || !reason.trim()}
          onClick={() => save('cite')}
        >
          保存引用
        </Button>
        {citation && citation.status !== 'withdrawn' && (
          <Button
            variant="outline"
            disabled={busy || !reason.trim()}
            onClick={() => save('citation.withdraw')}
          >
            撤回引用
          </Button>
        )}
      </div>
    </Modal>
  );
}
