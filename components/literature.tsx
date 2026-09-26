'use client';
import { useEffect, useState } from 'react';
import {
  FileText,
  ExternalLink,
  Check,
  History,
  Save,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Quote,
} from 'lucide-react';
import type { Project, Cell, Block } from '@/lib/domain';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge, statusNames, Empty, Label, Picker, request } from './common';
import PdfViewer from './pdf-viewer';
import { ResearchChat } from './research-chat';
import { selectMatrixPapers } from '@/lib/matrix-scope';
import { CandidateDifference } from './candidate-review';
import { ParsingQuality } from './parse-quality';
import { ParseEditor } from './parse-editor';
import { OcrPage } from './ocr-page';
import { NoteSource } from './note-source';
import { noteSourceStatus } from '@/lib/source-reference';

export type Mutate = (action: Record<string, unknown>) => Promise<boolean>;
export function Matrix({
  project,
  query,
  paperIds,
  onCell,
  onPaper,
  onField,
}: {
  project: Project;
  query: string;
  paperIds?: string[];
  onCell: (c: Cell) => void;
  onPaper: (id: string) => void;
  onField: (id: string) => void;
}) {
  const s = project.state;
  const papers = selectMatrixPapers(project, query, paperIds);
  if (!s.papers.length)
    return (
      <Empty title="比较表已准备好">
        <p>
          上传第一篇论文后，点击「提取文献信息」开始整理。也可以直接填写单元格并关联原文。
        </p>
      </Empty>
    );
  return (
    <div className="matrix-shell">
      <Table className="matrix">
        <TableHeader>
          <TableRow>
            <TableHead className="paper-col">
              文献 · {papers.length}/{s.papers.length}
            </TableHead>
            {s.fields.map((f) => (
              <TableHead key={f.id}>
                <button className="field-heading" onClick={() => onField(f.id)}>
                  {f.name}
                  <ArrowUpRight size={12} />
                </button>
                <span className="field-definition" title={f.definition}>
                  {f.definition}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {papers.map((p, i) => (
            <TableRow key={p.id}>
              <TableCell className="paper-col">
                <div className="paper-index">
                  {String(i + 1).padStart(2, '0')}
                  <FileText size={16} />
                </div>
                <button className="paper-title" onClick={() => onPaper(p.id)}>
                  {p.title}
                </button>
                <div className="paper-meta">
                  {p.kind.toUpperCase()} · {p.pages} 页{' '}
                  {p.sample && '· 虚构示例'}
                  {p.coverage === 'abstract'
                    ? '· 仅摘要，未获取全文'
                    : p.coverage === 'metadata'
                      ? '· 仅书目元数据'
                      : ''}
                </div>
              </TableCell>
              {s.fields.map((f) => {
                const c = s.cells.find(
                  (c) => c.paperId === p.id && c.fieldId === f.id,
                );
                return (
                  <TableCell key={f.id}>
                    <button
                      className={`matrix-cell ${c?.status === 'stale' ? 'stale-cell' : ''}`}
                      onClick={() => c && onCell(c)}
                    >
                      <span className={c?.value ? 'cell-value' : 'cell-empty'}>
                        {c?.value || '尚无数据'}
                      </span>
                      <span className="cell-footer">
                        <Badge kind={c?.status}>
                          {statusNames[c?.status ?? 'pending']}
                        </Badge>
                        {c?.sourceValid && (
                          <span className="source-page">
                            <Quote size={11} /> p.{c.page}
                          </span>
                        )}
                        {c?.candidate && (
                          <span
                            className="candidate-dot"
                            title="有新的复查候选"
                          />
                        )}
                      </span>
                    </button>
                  </TableCell>
                );
              })}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {!papers.length && (
        <div className="no-results">没有匹配的文献或字段值。</div>
      )}
    </div>
  );
}

export function EvidenceSheet({
  project,
  cellId,
  onClose,
  mutate,
  busy,
  onRead,
  onRule,
}: {
  project: Project;
  cellId: string | null;
  onClose: () => void;
  mutate: Mutate;
  busy: boolean;
  onRead: (paperId: string, blockId: string) => void;
  onRule: (fieldId: string, instruction: string) => void;
}) {
  const cell = project.state.cells.find((c) => c.id === cellId);
  const field = project.state.fields.find((f) => f.id === cell?.fieldId),
    paper = project.state.papers.find((p) => p.id === cell?.paperId);
  const [blocks, setBlocks] = useState<Block[]>([]),
    [error, setError] = useState(''),
    [value, setValue] = useState(cell?.value ?? ''),
    [quote, setQuote] = useState(cell?.quote ?? ''),
    [blockId, setBlockId] = useState(cell?.blockId ?? ''),
    [reason, setReason] = useState('');
  const paperId = cell?.paperId;
  useEffect(() => {
    let cancelled = false;
    if (paperId)
      request<{ blocks: Block[] }>(
        `/api/projects/${project.id}/papers/${paperId}`,
      )
        .then((d) => {
          if (!cancelled) setBlocks(d.blocks);
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    return () => {
      cancelled = true;
    };
  }, [project.id, paperId]);
  const block = blocks.find((b) => b.id === blockId);
  return (
    <Sheet
      open={!!cell}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className="evidence-sheet">
        <SheetHeader>
          <div className="eyebrow">EVIDENCE & REVISION</div>
          <SheetTitle>{field?.name || '核对证据'}</SheetTitle>
          <SheetDescription>{paper?.title}</SheetDescription>
        </SheetHeader>
        {cell && (
          <div className="sheet-body">
            <div className="row">
              <Badge kind={cell.status}>{statusNames[cell.status]}</Badge>
              <span className="secondary">
                {cell.origin === 'sample'
                  ? '虚构演示数据'
                  : cell.origin === 'manual'
                    ? '人工填写'
                    : '提取结果'}
              </span>
            </div>
            <p className="definition-box">{field?.definition}</p>
            {cell.evidenceRef && (
              <details>
                <summary>
                  关联图谱证据 · 引用时 v{cell.evidenceRef.graphRevision}
                </summary>
                <p className="secondary">证据 ID：{cell.evidenceRef.id}</p>
                <p className="secondary">
                  原始文件：{cell.evidenceRef.documentHash}
                </p>
                <p className="secondary">
                  解析版本：{cell.evidenceRef.parseHash}
                </p>
                {!cell.sourceValid && (
                  <p className="error-text">
                    关联证据已失效，请回到图谱重新引用并核对。
                  </p>
                )}
              </details>
            )}
            {cell.candidate && (
              <div className="candidate-box">
                <strong>新的复查候选</strong>
                <CandidateDifference project={project} cell={cell} />
                <div className="row">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      mutate({
                        action: 'cell.accept',
                        id: cell.id,
                        reason: reason.trim() || '逐项核对后接受候选',
                      })
                    }
                  >
                    接受候选
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      mutate({
                        action: 'cell.reject',
                        id: cell.id,
                        reason: reason.trim() || '逐项核对后保留原值',
                      })
                    }
                  >
                    保留原值
                  </Button>
                </div>
              </div>
            )}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await mutate({
                  action: 'cell.edit',
                  id: cell.id,
                  value,
                  reason,
                  blockId,
                  quote,
                });
              }}
            >
              <Label title="字段值">
                <Textarea
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  rows={3}
                  maxLength={1800}
                />
              </Label>
              <Label title="来源位置">
                <Picker
                  label="选择原文片段"
                  value={blockId}
                  onChange={(id) => {
                    setBlockId(id);
                    setQuote(
                      blocks.find((b) => b.id === id)?.text.slice(0, 2000) ??
                        '',
                    );
                  }}
                  options={blocks.map((b) => ({
                    value: b.id,
                    label: `第 ${b.page} 页 · ${b.text.slice(0, 48)}`,
                  }))}
                />
              </Label>
              {error && <p className="error-text">{error}</p>}
              {block && (
                <div className="source-box">
                  <div className="row">
                    <strong>原文 · 第 {block.page} 页</strong>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        onRead(cell.paperId, block.id);
                        onClose();
                      }}
                    >
                      打开原文
                      <ExternalLink size={14} />
                    </Button>
                  </div>
                  <p>{block.text}</p>
                </div>
              )}
              <Label
                title="引用摘录"
                hint="保留原文中的连续文字。系统检查它是否存在于所选片段。"
              >
                <Textarea
                  value={quote}
                  onChange={(e) => setQuote(e.target.value)}
                  rows={3}
                  maxLength={2000}
                />
              </Label>
              <Label title="核对或修改说明">
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="例如：只统计独立测试集，不包含训练样本"
                  rows={2}
                  maxLength={1800}
                />
              </Label>
              {!cell.sourceValid && (
                <p className="help-text">
                  当前值尚无通过位置校验的原文依据。人工确认与来源校验会分别记录。
                </p>
              )}
              <div className="row">
                <Button type="submit" disabled={busy}>
                  <Check />
                  确认并保存
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || reason.trim().length < 3}
                  onClick={async () => {
                    if (
                      await mutate({
                        action: 'cell.edit',
                        id: cell.id,
                        value,
                        reason,
                        blockId,
                        quote,
                      })
                    ) {
                      onClose();
                      onRule(cell.fieldId, reason);
                    }
                  }}
                >
                  将修改说明用于同类复查
                </Button>
              </div>
            </form>
            <div className="history-section">
              <h3>
                <History size={16} />
                修改历史 <span>{cell.history.length}</span>
              </h3>
              {!cell.history.length ? (
                <p className="secondary">首次核对后会保留修改记录。</p>
              ) : (
                cell.history.toReversed().map((h, i) => (
                  <div className="history-item" key={`${h.at}-${i}`}>
                    <div>
                      <strong>{h.value.value || '空值'}</strong>
                      <small>
                        {h.reason} · {new Date(h.at).toLocaleString('zh-CN')}
                      </small>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        mutate({
                          action: 'cell.restore',
                          id: cell.id,
                          index: cell.history.length - 1 - i,
                        })
                      }
                    >
                      恢复
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function Reader({
  onProject,
  project,
  selectedId,
  focusBlock,
  focusVersion,
  onSource,
  editContext,
  select,
  mutate,
  busy,
  aiConfigured,
}: {
  onProject: (p: Project) => void;
  project: Project;
  selectedId: string;
  focusBlock: string;
  focusVersion: number;
  onSource: (id: string, block?: string) => void;
  editContext: () => void;
  select: (id: string) => void;
  mutate: Mutate;
  busy: boolean;
  aiConfigured: boolean;
}) {
  const paper =
    project.state.papers.find((p) => p.id === selectedId) ??
    project.state.papers[0];
  const [editingParse, setEditingParse] = useState(false);
  const [ocrOpen, setOcrOpen] = useState(false);
  const [reviewNoteId, setReviewNoteId] = useState('');
  const [blocks, setBlocks] = useState<Block[]>([]),
    [active, setActive] = useState(focusBlock),
    [note, setNote] = useState(''),
    [loading, setLoading] = useState(Boolean(paper)),
    [error, setError] = useState(''),
    [page, setPage] = useState(1);
  useEffect(() => {
    let cancelled = false;
    const currentPaperId = paper?.id;
    if (currentPaperId) {
      request<{ blocks: Block[] }>(
        `/api/projects/${project.id}/papers/${currentPaperId}`,
      )
        .then((d) => {
          if (!cancelled) {
            setBlocks(d.blocks);
            const target = d.blocks.find((b) => b.id === focusBlock);
            if (target) {
              setActive(target.id);
              setPage(target.page);
            }
          }
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [project.id, paper?.id, paper?.parseVersionId, focusBlock, focusVersion]);
  const choose = (b: Block) => {
    setActive(b.id);
    setPage(b.page);
  };
  if (!paper)
    return (
      <Empty title="还没有文献">
        <p>上传 PDF 或 TXT 后，可以阅读原文、保存笔记和核对提取结果。</p>
      </Empty>
    );
  return (
    <div className="reader-layout">
      <aside className="paper-list">
        <h3>
          课题文献 <span>{project.state.papers.length}</span>
        </h3>
        {project.state.papers.map((p) => (
          <button
            key={p.id}
            className={`paper-list-item ${p.id === paper.id ? 'selected' : ''}`}
            onClick={() => select(p.id)}
          >
            <FileText size={17} />
            <span>
              {p.title}
              <small>
                {p.pages} 页 ·{' '}
                {p.sample
                  ? '虚构示例'
                  : p.coverage === 'abstract'
                    ? '仅摘要'
                    : p.coverage === 'metadata'
                      ? '仅书目'
                      : p.kind.toUpperCase()}
              </small>
            </span>
          </button>
        ))}
      </aside>
      <section className="reader-center">
        {ocrOpen && (
          <OcrPage
            key={paper.id}
            project={project}
            paper={paper}
            page={page}
            onProject={onProject}
            onClose={() => setOcrOpen(false)}
          />
        )}
        {project.state.notes.find((n) => n.id === reviewNoteId) && (
          <NoteSource
            key={reviewNoteId}
            project={project}
            note={project.state.notes.find((n) => n.id === reviewNoteId)!}
            onProject={onProject}
            onClose={() => setReviewNoteId('')}
          />
        )}
        {editingParse && (
          <ParseEditor
            key={paper.id}
            project={project}
            paper={paper}
            active={active}
            onProject={onProject}
            onClose={() => setEditingParse(false)}
          />
        )}
        <div className="reader-bar">
          <strong title={paper.title}>{paper.title}</strong>
          {!paper.metadata && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy || loading || !!error}
              onClick={() => setEditingParse(true)}
            >
              解析纠错 / 版本
            </Button>
          )}
          <a
            href={`/api/projects/${project.id}/papers/${paper.id}?raw=1`}
            target="_blank"
            rel="noreferrer"
            title="在新窗口打开原文件"
          >
            <ExternalLink size={16} />
          </a>
        </div>
        {paper.sample && (
          <div className="sample-banner">
            此文献与数据均为虚构，只用于体验功能。
          </div>
        )}
        {paper.parseVersionId && (
          <p className="secondary padded">
            当前解析 v{paper.parseVersions?.length} ·
            已有人工纠错或恢复记录；原始文件保留，可在「解析纠错 /
            版本」中对照历史。
          </p>
        )}
        {error && <p className="error-text padded">{error}</p>}
        {loading ? (
          <div className="loading-line">正在读取文献…</div>
        ) : (
          <>
            {!error && (
              <ParsingQuality
                paper={paper}
                blocks={blocks}
                onPage={(next) => {
                  setPage(next);
                  setActive('');
                }}
              />
            )}
            <div className="reader-pages">
              {paper.kind === 'pdf' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !aiConfigured || !!error}
                  onClick={() => setOcrOpen(true)}
                >
                  识别本页（OCR）
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                disabled={page <= 1}
                onClick={() => {
                  setPage(page - 1);
                  setActive('');
                }}
                aria-label="上一页"
              >
                <ChevronLeft />
              </Button>
              <span>
                第 {page} / {paper.pages} 页
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={page >= paper.pages}
                onClick={() => {
                  setPage(page + 1);
                  setActive('');
                }}
                aria-label="下一页"
              >
                <ChevronRight />
              </Button>
            </div>
            {paper.kind === 'pdf' && (
              <PdfViewer
                url={`/api/projects/${project.id}/papers/${paper.id}?raw=1`}
                page={page}
                block={blocks.find((b) => b.id === active)}
              />
            )}
            <div className="text-blocks">
              <div className="row">
                <h3>
                  {paper.coverage === 'abstract'
                    ? '摘要原文（未获取全文）'
                    : paper.coverage === 'metadata'
                      ? '书目元数据（无摘要或全文）'
                      : paper.parseVersionId
                        ? '当前版本解析文本'
                        : paper.kind === 'pdf'
                          ? '解析文本'
                          : '文献原文'}
                </h3>
                <span className="secondary">选择片段进行解释或记录笔记</span>
              </div>
              {blocks
                .filter((b) => b.page === page)
                .map((b) => (
                  <button
                    key={b.id}
                    className={`text-block ${b.id === active ? 'active' : ''}`}
                    onClick={() => choose(b)}
                  >
                    <span className="block-number">
                      § {blocks.indexOf(b) + 1}
                    </span>
                    <span>{b.text}</span>
                  </button>
                ))}
              {!blocks.some((b) => b.page === page) && !error && (
                <p className="secondary">
                  本页没有可引用的解析文字，请对照上方原始页面。
                </p>
              )}
            </div>
          </>
        )}
      </section>
      <aside className="reading-assistant">
        <Tabs defaultValue="ask">
          <TabsList>
            <TabsTrigger value="ask">阅读助手</TabsTrigger>
            <TabsTrigger value="notes">我的笔记</TabsTrigger>
          </TabsList>
          <TabsContent value="ask">
            <ResearchChat
              onProject={onProject}
              key={paper.parseVersionId ?? 'original'}
              project={project}
              paperId={paper.id}
              active={active}
              onSource={onSource}
              editContext={editContext}
              mutate={mutate}
              busy={busy}
              aiConfigured={aiConfigured}
            />
          </TabsContent>
          <TabsContent value="notes">
            <Label title="阅读笔记">
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={5}
                placeholder="记录方法、疑问，或与自己课题的联系…"
                maxLength={3000}
              />
            </Label>
            <Button
              disabled={busy || !note.trim()}
              onClick={async () => {
                if (
                  await mutate({
                    action: 'note.add',
                    paperId: paper.id,
                    blockId: active,
                    text: note,
                  })
                )
                  setNote('');
              }}
            >
              <Save />
              保存笔记
            </Button>
            <div className="note-list">
              {project.state.notes.toReversed().map((n) => (
                <div key={n.id} className="note">
                  <strong>
                    {
                      project.state.papers.find((p) => p.id === n.paperId)
                        ?.title
                    }
                  </strong>
                  <p>{n.text}</p>
                  {['stale', 'legacy'].includes(
                    noteSourceStatus(n, project.state.papers),
                  ) && (
                    <p className="error-text">
                      原文版本已变化或缺少旧来源快照，请重新核对；笔记正文保留。
                    </p>
                  )}
                  {n.source && <blockquote>{n.source.quote}</blockquote>}
                  {n.source?.graphEvidence && (
                    <small>
                      图谱证据关联 · 引用时图谱 v
                      {n.source.graphEvidence.graphRevision}
                    </small>
                  )}
                  <small>
                    {
                      {
                        observation: '个人观察 · 未绑定片段',
                        legacy: '旧来源未核对',
                        stale: '来源待复查',
                        linked: '已绑定原文 · 尚未人工核对',
                        reviewed: '已人工核对来源',
                      }[noteSourceStatus(n, project.state.papers)]
                    }
                  </small>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setReviewNoteId(n.id)}
                  >
                    核对 / 重新绑定来源
                  </Button>
                  <small>{new Date(n.at).toLocaleString('zh-CN')}</small>
                  {n.blockId &&
                    ['linked', 'reviewed'].includes(
                      noteSourceStatus(n, project.state.papers),
                    ) && (
                      <button
                        onClick={() => {
                          onSource(n.paperId, n.blockId);
                        }}
                      >
                        查看来源
                      </button>
                    )}
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </aside>
    </div>
  );
}
