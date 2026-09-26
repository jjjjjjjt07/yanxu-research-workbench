'use client';
import { useEffect, useState, useRef } from 'react';
import { Sparkles, ArrowUpRight } from 'lucide-react';
import type { Project } from '@/lib/domain';
import type { Mutate } from './literature';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Label, Picker, Modal, request } from './common';
import { AnswerHistory } from './answer-history';
import { Snapshot } from './observations';

import type { ReadingAnswer as Answer } from '@/lib/reading-answer';

type Turn = Answer & { question: string; id: number };
const feedbackNames = {
  tried: '已尝试',
  unsuitable: '不适用',
  verify: '留待验证',
};

export function ResearchChat({
  project,
  onProject,
  paperId,
  active,
  onSource,
  editContext,
  mutate,
  busy,
  aiConfigured,
}: {
  project: Project;
  onProject: (p: Project) => void;
  paperId: string;
  active: string;
  onSource: (paperId: string, blockId?: string) => void;
  editContext: () => void;
  mutate: Mutate;
  busy: boolean;
  aiConfigured: boolean;
}) {
  const [scope, setScope] = useState('all');
  const [answerMode, setAnswerMode] = useState('analysis');
  const [selected, setSelected] = useState<string[]>([]);
  const [selectedObservations, setSelectedObservations] = useState<string[]>(
    [],
  );
  const [question, setQuestion] = useState('');
  const [turnState, setTurnState] = useState<{ signature: string; turns: Turn[] }>({ signature: '', turns: [] });
  const [asking, setAsking] = useState(false);
  const [errorState, setErrorState] = useState({ signature: '', message: '' });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [feedback, setFeedback] = useState<{
    id?: string;
    paperIds: string[];
    text: string;
    status: 'tried' | 'unsuitable' | 'verify';
    reason: string;
  } | null>(null);
  const ids =
    scope === 'all'
      ? project.state.papers.map((p) => p.id)
      : scope === 'selected'
        ? selected
        : [paperId];
  const signature =
    answerMode +
    ':' +
    scope +
    ':' +
    ids.join(',') +
    ':' +
    JSON.stringify(
      selectedObservations.map((id) => {
        const o = project.state.observations?.find((o) => o.id === id);
        return [id, o?.revision ?? 1, o?.status];
      }),
    ) +
    (scope === 'fragment' ? ':' + active : '');
  const latestScope = useRef(signature);
  const scopeEpoch = useRef(0);
  const turns = turnState.signature === signature ? turnState.turns : [];
  const error = errorState.signature === signature ? errorState.message : '';
  useEffect(() => {
    scopeEpoch.current += 1;
    latestScope.current = signature;
    queueMicrotask(() => {
      if (latestScope.current !== signature) return;
      setTurnState({ signature, turns: [] });
      setErrorState({ signature, message: '' });
    });
  }, [signature]);
  async function ask() {
    const input = question.trim();
    if (!input || !ids.length || (scope === 'fragment' && !active) || asking)
      return;
    const requestedEpoch = scopeEpoch.current;
    setAsking(true);
    setErrorState({ signature, message: '' });
    try {
      const answer = await request<Answer>(`/api/projects/${project.id}/ai`, {
        method: 'POST',
        body: JSON.stringify({
          task: 'ask',
          mode: answerMode,
          paperIds: ids,
          observationIds: selectedObservations,
          question: input,
          blockId: scope === 'fragment' ? active : undefined,
          history: turns.slice(-6).map((t) => ({
            question: t.question,
            answer: t.answer.slice(0, 7000),
          })),
        }),
      });
      if (latestScope.current === signature && scopeEpoch.current === requestedEpoch) {
        setTurnState((previous) => ({
          signature,
          turns: [
            ...(previous.signature === signature ? previous.turns : []),
            { ...answer, question: input, id: Date.now() },
          ].slice(-12),
        }));
        setQuestion('');
      }
    } catch (e) {
      if (latestScope.current === signature && scopeEpoch.current === requestedEpoch)
        setErrorState({ signature, message: (e as Error).message });
    } finally {
      setAsking(false);
    }
  }
  function sourceChanged(source: Answer['sources'][number]) {
    const paper = project.state.papers.find((p) => p.id === source.paperId),
      ref = source.reference;
    return (
      !paper ||
      (!!ref &&
        (paper.hash !== ref.documentHash ||
          (paper.parsing && paper.parsing.hash !== ref.parseHash) ||
          (paper.parseVersionId ?? 'original') !== ref.parseVersionId))
    );
  }
  return (
    <>
      {historyOpen && (
        <AnswerHistory
          projectId={project.id}
          onProject={onProject}
          onSource={onSource}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)}>
        已保存的问答
      </Button>
      <div className="assistant-heading">
        <Sparkles size={18} />
        <strong>围绕课题阅读</strong>
      </div>
      <div className="research-profile">
        <strong>{project.title}</strong>
        <p>{project.question || '研究目标尚未填写，请完善课题档案。'}</p>
        <dl>
          <dt>设备与数据</dt>
          <dd>{project.state.profile?.equipment || '未填写'}</dd>
          <dt>目前方法</dt>
          <dd>{project.state.profile?.currentMethod || '未填写'}</dd>
          <dt>限制与标准</dt>
          <dd>{project.state.profile?.constraints || '未填写'}</dd>
        </dl>
        <p>
          每次提问会参考此档案、{project.state.notes.length} 条笔记和{' '}
          {project.state.readingFeedback?.length ?? 0} 条阅读反馈。
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={asking || busy}
          onClick={editContext}
        >
          完善课题档案
        </Button>
      </div>
      <Label title="本次问答范围">
        <Picker
          label="问答范围"
          value={scope}
          disabled={asking}
          onChange={setScope}
          options={[
            {
              value: 'all',
              label: `全部文献（${project.state.papers.length} 篇）`,
            },
            { value: 'selected', label: '自选多篇文献' },
            { value: 'current', label: '当前文献全文' },
            { value: 'fragment', label: '当前选中片段' },
          ]}
        />
      </Label>
      {!!project.state.observations?.length && (
        <details>
          <summary>
            本次参考的实验观察（已选{selectedObservations.length}/5）
          </summary>
          <p className="secondary">
            按需选择；将作为用户实验记录参考，不当作论文事实。带计算的观察会附完整输入、结果与统计前提；切换选择会开始新对话。
          </p>
          {project.state.observations.map((o) => (
            <label key={o.id} className="paper-check">
              <Checkbox
                checked={selectedObservations.includes(o.id)}
                disabled={
                  asking ||
                  (o.status !== 'recorded' &&
                    !selectedObservations.includes(o.id)) ||
                  (!selectedObservations.includes(o.id) &&
                    selectedObservations.length >= 5)
                }
                onCheckedChange={(checked) =>
                  setSelectedObservations((old) =>
                    checked ? [...old, o.id] : old.filter((id) => id !== o.id),
                  )
                }
              />
              {o.text.slice(0, 100)} ·{' '}
              {o.calculation ? '含已复算的计算依据 · ' : ''}
              {o.status === 'recorded'
                ? '已记录'
                : o.status === 'withdrawn'
                  ? '已撤回'
                  : '待复查'}
            </label>
          ))}
        </details>
      )}
      {scope === 'selected' && (
        <div className="reading-selection">
          {project.state.papers.map((p) => (
            <label key={p.id} className="paper-check">
              <Checkbox
                checked={selected.includes(p.id)}
                disabled={asking}
                onCheckedChange={(checked) =>
                  setSelected((old) =>
                    checked ? [...old, p.id] : old.filter((id) => id !== p.id),
                  )
                }
              />
              {p.title}
            </label>
          ))}
        </div>
      )}
      <p className="help-text">
        本次使用 {ids.length}{' '}
        篇。切换问答范围会开始新对话；长文会按篇检索片段并列出覆盖范围。
      </p>
      {scope === 'fragment' && !active && (
        <p className="warning-text">请先在左侧原文中选择一个片段。</p>
      )}
      <Picker
        label="回答模式"
        value={answerMode}
        onChange={setAnswerMode}
        disabled={asking}
        options={[
          { value: 'analysis', label: '证据分析 · 逐项主张' },
          { value: 'excerpts', label: '原文摘录 · 不生成推断' },
        ]}
      />
      <div className="research-conversation" aria-live="polite">
        {turns.map((turn) => (
          <div className="answer-box" key={turn.id}>
            <strong>你：{turn.question}</strong>
            {turn.savedAnswerId && <small>已保存到问答历史</small>}
            {turn.persistenceError && (
              <p className="error-text">{turn.persistenceError}</p>
            )}
            {(turn.sourceNeedsReview || turn.sources.some(sourceChanged)) && (
              <p className="error-text">
                回答期间资料已变化，请在问答历史中核对最新来源状态。
              </p>
            )}
            <p className="answer-text">{turn.answer}</p>
            {turn.statements?.map((s, index) => (
              <details key={index}>
                <summary>
                  主张 {index + 1} · 文献依据{' '}
                  {s.sourceIndices.map((i) => i + 1).join('、') || '缺失'} ·
                  {!!s.observationIndices?.length && (
                    <>
                      用户实验观察{' '}
                      {s.observationIndices.map((i) => i + 1).join('、')} ·{' '}
                    </>
                  )}
                  待人工核对
                </summary>
                <p>{s.reason}</p>
                {s.sourceIndices.map((i) => {
                  const source = turn.sources[i];
                  return source ? (
                    <Button
                      variant="ghost"
                      key={i}
                      onClick={() =>
                        onSource(
                          source.paperId,
                          sourceChanged(source) ? undefined : source.blockId,
                        )
                      }
                    >
                      {source.paperTitle} · p{source.page}
                    </Button>
                  ) : null;
                })}
              </details>
            ))}
            {(turn.observations ?? []).map((ref, i) => (
              <details key={ref.id}>
                <summary>本次参考的用户实验观察 {i + 1}</summary>
                <Snapshot value={ref.snapshot} />
              </details>
            ))}
            <small>
              使用课题「{turn.context.title}」· {turn.context.noteCount} 条笔记
              · {turn.context.feedbackCount} 条反馈
            </small>
            {turn.unverified && (
              <p className="warning-text">
                回答中有缺失或未通过校验的引用，请核对原文。课题条件和用户记录本身不是论文证据。
              </p>
            )}
            {turn.sources.map((source, i) => (
              <Button
                variant="ghost"
                className="source-link"
                key={i}
                disabled={asking}
                onClick={() =>
                  onSource(
                    source.paperId,
                    sourceChanged(source) ? undefined : source.blockId,
                  )
                }
              >
                依据 {i + 1} · {source.paperTitle} · 第 {source.page} 页<br />
                {source.quote.slice(0, 100)}
                <ArrowUpRight size={13} />
              </Button>
            ))}
            <details>
              <summary>本次分析覆盖 {turn.coverage.length} 篇文献</summary>
              {turn.coverage.map((c) => (
                <p key={c.paperId}>
                  {c.title}：
                  {c.mode === 'abstract'
                    ? '仅摘要（未获取全文）'
                    : c.mode === 'metadata'
                      ? '仅书目元数据'
                      : c.mode === 'incomplete'
                        ? '解析有缺页或质量问题'
                        : c.mode === 'parsed'
                          ? '全部已提取文字（图像、表格及公式未保证完整）'
                          : c.mode === 'full'
                            ? '全部解析文字'
                            : c.mode === 'fragment'
                              ? '选中片段'
                              : '检索片段'}
                  （{c.includedBlocks}/{c.totalBlocks} 段）
                  {c.parsing?.qualityWarnings.map((warning) => (
                    <span className="error-text" key={warning}>
                      ；{warning}
                    </span>
                  ))}
                </p>
              ))}
            </details>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || asking}
              onClick={() =>
                setFeedback({
                  paperIds: turn.coverage.map((c) => c.paperId),
                  text: turn.answer.slice(0, 5000),
                  status: 'verify',
                  reason: '',
                })
              }
            >
              记录使用反馈
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || asking}
              onClick={() =>
                mutate({
                  action: 'note.add',
                  paperId: turn.sources[0]?.paperId ?? turn.coverage[0].paperId,
                  blockId: turn.sources[0]?.blockId ?? '',
                  text: turn.answer.slice(0, 3000),
                  parseHash: turn.sources[0]?.reference?.parseHash,
                  parseVersionId: turn.sources[0]?.reference?.parseVersionId,
                  quote: turn.sources[0]?.quote,
                })
              }
            >
              保存为笔记
            </Button>
          </div>
        ))}
      </div>
      <Label title={turns.length ? '继续追问' : '想了解什么？'}>
        <Textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={3000}
          rows={4}
          disabled={asking}
          placeholder="结合我的设备条件，比较这些论文的方法；哪些值得尝试，哪些存在资源差距？"
        />
      </Label>
      <Button
        disabled={
          (!aiConfigured && answerMode !== 'excerpts') ||
          busy ||
          asking ||
          !question.trim() ||
          !ids.length ||
          (scope === 'fragment' && !active)
        }
        onClick={ask}
      >
        {asking ? `正在分析 ${ids.length} 篇文献…` : '结合原文回答'}
      </Button>
      {turns.length > 0 && (
        <Button variant="ghost" disabled={asking} onClick={() => setTurnState({ signature, turns: [] })}>
          开始新对话
        </Button>
      )}
      {!aiConfigured && <p className="help-text">请先连接模型。</p>}
      {error && <p className="error-text">{error}</p>}
      <details className="feedback-records">
        <summary>
          课题阅读反馈（{project.state.readingFeedback?.length ?? 0}）
        </summary>
        <p className="help-text">
          保存后会参与后续阅读。可修改状态或移除；记录的是你的实践判断。
        </p>
        {(project.state.readingFeedback ?? []).toReversed().map((r) => (
          <div className="note" key={r.id}>
            <strong>{feedbackNames[r.status]}</strong>
            <p>{r.text}</p>
            <p>原因：{r.reason}</p>
            {r.paperIds.map((id) => (
              <Button
                variant="ghost"
                size="sm"
                key={id}
                onClick={() => onSource(id)}
              >
                {project.state.papers.find((p) => p.id === id)?.title}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              disabled={busy || asking}
              onClick={() => setFeedback(r)}
            >
              更新状态与原因
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || asking}
              onClick={() =>
                mutate({ action: 'reading.feedback.remove', id: r.id })
              }
            >
              移除记录
            </Button>
          </div>
        ))}
      </details>
      <Modal
        open={!!feedback}
        onClose={() => setFeedback(null)}
        title="记录阅读建议的使用情况"
        description="明确哪些建议已尝试、为何不适用，后续 AI 分析会参考这些记录。"
      >
        {feedback && (
          <>
            <Label title="建议或观察">
              <Textarea
                value={feedback.text}
                maxLength={5000}
                rows={5}
                onChange={(e) =>
                  setFeedback({ ...feedback, text: e.target.value })
                }
              />
            </Label>
            <Label title="状态">
              <Picker
                value={feedback.status}
                label="使用状态"
                options={Object.entries(feedbackNames).map(
                  ([value, label]) => ({ value, label }),
                )}
                onChange={(status) =>
                  setFeedback({
                    ...feedback,
                    status: status as typeof feedback.status,
                  })
                }
              />
            </Label>
            <Label title="实践结果或原因">
              <Textarea
                value={feedback.reason}
                maxLength={1500}
                rows={3}
                onChange={(e) =>
                  setFeedback({ ...feedback, reason: e.target.value })
                }
                placeholder="例如：该方案依赖 GPU，而目前只能使用 CPU。"
              />
            </Label>
            <Button
              disabled={
                busy || !feedback.text.trim() || !feedback.reason.trim()
              }
              onClick={async () => {
                if (await mutate({ ...feedback, action: 'reading.feedback' }))
                  setFeedback(null);
              }}
            >
              保存并用于后续阅读
            </Button>
          </>
        )}
      </Modal>
    </>
  );
}
