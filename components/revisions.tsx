'use client';
import { useState } from 'react';
import {
  Save,
  Sparkles,
  ListChecks,
  Download,
  History,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { Project, ReviewItem } from '@/lib/domain';
import type { Mutate } from './literature';
import { ManuscriptCitations } from './manuscript-citations';
import { ObservationCitations } from './observation-citations';
import {
  Label,
  Badge,
  statusNames,
  Empty,
  Modal,
  Picker,
  downloadFile,
} from './common';

export function Revisions({
  project,
  mutate,
  busy,
  aiConfigured,
  onAnalyze,
  onProject,
}: {
  project: Project;
  mutate: Mutate;
  busy: boolean;
  aiConfigured: boolean;
  onAnalyze: () => void;
  onProject: (p: Project) => void;
}) {
  const r = project.state.review;
  const [oldText, setOld] = useState(r.oldText),
    [newText, setNew] = useState(r.newText),
    [feedback, setFeedback] = useState(r.feedback),
    [itemId, setItem] = useState(''),
    [status, setStatus] = useState('open'),
    [evidence, setEvidence] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [historyOpen, setHistoryOpen] = useState(false);
  const dirty =
    oldText !== r.oldText || newText !== r.newText || feedback !== r.feedback;
  const item = r.items.find((i) => i.id === itemId);
  function edit(i: ReviewItem) {
    setItem(i.id);
    setStatus(i.status);
    setEvidence(i.evidence);
    setConfirmation(i.confirmation);
  }
  const before = r.oldText.split('\n'),
    after = r.newText.split('\n');
  function exportReply() {
    const content = [
      '# 修改意见处理记录',
      '',
      ...r.items.flatMap((i, n) => [
        `## ${n + 1}. ${i.instruction}`,
        `状态：${statusNames[i.status]}`,
        '',
        `作者说明：${i.confirmation || '尚待作者填写'}`,
        '',
        i.evidence
          ? `新稿依据：\n> ${i.evidence.replace(/\n/g, '\n> ')}`
          : '新稿依据：尚未关联',
        '',
      ]),
    ].join('\n');
    downloadFile('修改意见处理记录.md', content);
  }
  return (
    <>
      <div className="toolbar">
        <div className="row">
          <Badge kind="confirmed">
            {r.items.filter((i) => i.status === 'done').length} /{' '}
            {r.items.length} 已完成
          </Badge>
          <span className="secondary">每条修改意见都对应可核对的落实记录</span>
        </div>
        <div className="row">
          <Button variant="outline" onClick={() => setHistoryOpen(true)}>
            <History />
            全部版本（{r.versions?.length ?? 0}）
          </Button>
          <Button
            variant="outline"
            disabled={!r.items.length}
            onClick={exportReply}
          >
            <Download />
            导出处理记录
          </Button>
        </div>
      </div>
      <div className="revision-grid">
        <section className="panel draft-panel">
          <Tabs defaultValue="edit">
            <div className="panel-heading">
              <h2>稿件版本</h2>
              <TabsList>
                <TabsTrigger value="edit">编辑内容</TabsTrigger>
                <TabsTrigger value="diff">文字对照</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="edit">
              <div className="draft-columns">
                <Label title="修改前">
                  <Textarea
                    rows={12}
                    value={oldText}
                    onChange={(e) => setOld(e.target.value)}
                    maxLength={18000}
                    placeholder="粘贴修改前的论文段落…"
                  />
                </Label>
                <Label title="修改后">
                  <Textarea
                    rows={12}
                    value={newText}
                    onChange={(e) => setNew(e.target.value)}
                    maxLength={18000}
                    placeholder="粘贴修改后的论文段落…"
                  />
                </Label>
              </div>
              <Label
                title="导师或审稿人的意见"
                hint="每行一条。保存新版本会保留旧记录，并重新开始意见核对。"
              >
                <Textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  rows={5}
                  maxLength={8000}
                  placeholder="补充实验设置。\n解释为什么选择这个对照方法。"
                />
              </Label>
              <div className="row">
                <Button
                  disabled={busy || !dirty}
                  onClick={() =>
                    mutate({
                      action: 'review.save',
                      oldText,
                      newText,
                      feedback,
                    })
                  }
                >
                  <Save />
                  保存版本
                </Button>
                {dirty && <span className="warning-text">有未保存的修改</span>}
              </div>
            </TabsContent>
            <TabsContent value="diff">
              {!r.oldText && !r.newText ? (
                <Empty title="先保存稿件版本">
                  <p>保存后可对照新增和删除的文字。</p>
                </Empty>
              ) : (
                <>
                  <p className="help-text padded">
                    按整行匹配标记新增与删除；移动的相同段落不标作内容变化。
                  </p>
                  <div className="diff-columns">
                    <div>
                      <h4>修改前</h4>
                      {before.map((line, i) => (
                        <p
                          key={i}
                          className={
                            !after.includes(line) ? 'diff-removed' : ''
                          }
                        >
                          {!after.includes(line) ? '− ' : '  '}
                          {line || ' '}
                        </p>
                      ))}
                    </div>
                    <div>
                      <h4>修改后</h4>
                      {after.map((line, i) => (
                        <p
                          key={i}
                          className={!before.includes(line) ? 'diff-added' : ''}
                        >
                          {!before.includes(line) ? '+ ' : '  '}
                          {line || ' '}
                        </p>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        </section>
        <section className="panel review-panel">
          <div className="panel-heading">
            <h2>意见落实</h2>
            <ListChecks size={20} />
          </div>
          <div className="review-actions">
            <Button
              disabled={
                busy || dirty || !r.feedback.trim() || r.items.length > 0
              }
              variant="outline"
              onClick={() => mutate({ action: 'review.manual' })}
            >
              按行建立清单
            </Button>
            <Button
              disabled={
                busy ||
                dirty ||
                !aiConfigured ||
                !r.newText.trim() ||
                !r.feedback.trim()
              }
              onClick={onAnalyze}
            >
              <Sparkles />
              AI 核对修改
            </Button>
          </div>
          {!aiConfigured && (
            <p className="help-text padded">
              尚未连接模型，可以先手动建立清单并关联修改证据。
            </p>
          )}
          {!r.items.length ? (
            <div className="mini-empty">
              保存稿件和修改意见后，建立待核对的事项清单。
            </div>
          ) : (
            r.items.map((i, n) => (
              <div className="review-card" key={i.id}>
                <div className="row">
                  <span className="review-number">
                    {String(n + 1).padStart(2, '0')}
                  </span>
                  <Badge kind={i.status}>{statusNames[i.status]}</Badge>
                </div>
                <h3>{i.instruction}</h3>
                <p className="secondary">{i.explanation}</p>
                {i.evidence && <blockquote>{i.evidence}</blockquote>}
                {i.confirmation && <p>{i.confirmation}</p>}
                <Button size="sm" variant="outline" onClick={() => edit(i)}>
                  <Check />
                  核对落实情况
                </Button>
              </div>
            ))
          )}
        </section>
      </div>
      <ManuscriptCitations
        project={project}
        onProject={onProject}
        busy={busy}
        dirty={dirty}
      />
      <ObservationCitations
        project={project}
        onProject={onProject}
        busy={busy}
        dirty={dirty}
      />
      <Modal
        open={!!item}
        onClose={() => setItem('')}
        title="核对修改意见"
        description={item?.instruction}
      >
        <Label title="新稿中的修改证据" hint="请粘贴新稿中实际存在的连续原文。">
          <Textarea
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            rows={4}
            maxLength={3000}
          />
        </Label>
        <Label
          title="落实说明"
          hint="涉及补充实验时，请说明对应实验与结果，不能仅凭文字变化判断。"
        >
          <Textarea
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            rows={3}
            maxLength={3000}
          />
        </Label>
        <Label title="处理状态">
          <Picker
            value={status}
            onChange={setStatus}
            label="选择状态"
            options={['open', 'partial', 'review', 'done'].map((v) => ({
              value: v,
              label: statusNames[v],
            }))}
          />
        </Label>
        <Button
          disabled={busy || (status === 'done' && !confirmation.trim())}
          onClick={async () => {
            if (
              await mutate({
                action: 'review.item',
                id: item!.id,
                status,
                evidence,
                confirmation,
              })
            )
              setItem('');
          }}
        >
          保存核对结果
        </Button>
      </Modal>
      <Modal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title="历史稿件版本"
        wide
      >
        <div className="history-modal">
          {r.versions?.toReversed().map((v) => (
            <details key={v.id}>
              <summary>
                v{v.number} ·{' '}
                {v.at
                  ? new Date(v.at).toLocaleString('zh-CN')
                  : '旧稿基线，原始时间未知'}
                {v.restoredFrom ? ' · 从历史恢复' : ''}
              </summary>
              <p>{v.newText || v.oldText}</p>
              <p>{v.feedback}</p>
              <Button
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  if (await mutate({ action: 'review.restore', id: v.id })) {
                    setOld(v.oldText);
                    setNew(v.newText);
                    setFeedback(v.feedback);
                    setHistoryOpen(false);
                  }
                }}
              >
                恢复为新版本
              </Button>
            </details>
          ))}
          {!r.history.length ? (
            <p className="secondary">
              {r.versions?.length
                ? '当前还没有旧的意见核对记录。'
                : '首次保存稿件将创建 v1，并显示在这里。'}
            </p>
          ) : (
            r.history.toReversed().map((h, i) => (
              <details key={i}>
                <summary>
                  {new Date(h.at).toLocaleString('zh-CN')} · {h.items.length}{' '}
                  条核对记录
                </summary>
                <strong>修改后内容</strong>
                <p>{h.newText}</p>
                <strong>意见</strong>
                <p>{h.feedback}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    downloadFile(
                      `稿件历史-${r.history.length - i}.json`,
                      JSON.stringify(h, null, 2),
                      'application/json',
                    )
                  }
                >
                  导出此版本
                </Button>
              </details>
            ))
          )}
        </div>
      </Modal>
    </>
  );
}
