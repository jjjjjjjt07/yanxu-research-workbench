'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Network,
  List,
  Sparkles,
  Search,
  RefreshCw,
  Download,
  ArrowRight,
  GitMerge,
  Save,
  FileText,
  Link2,
  Check,
  X,
  History,
  Expand,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { CitationNetwork } from './citation-network';
import { GraphEvidenceUse } from './graph-evidence-use';
import { Observations } from './observations';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Picker,
  Badge,
  Label,
  Empty,
  Modal,
  request,
  downloadFile,
} from './common';
import { REJECT_RULES, type Project } from '@/lib/domain';
import {
  type Graph,
  type Entity,
  type Relation,
  nodeNames,
  relationNames,
  reviewNames,
  visibleRelations,
  neighborhood,
  evidencePath,
  jobCounts,
  activeEntity,
  emptyGraph,
  relationTypeIssue,
  entityPaperIds,
} from '@/lib/graph';

type GraphJob = {
  id: string;
  batchId: string;
  paperId: string;
  task: string;
  status: string;
  stage: string;
  error: string | null;
  errorKind: string | null;
  attempts: number;
  updatedAt: string;
};
type GraphData = {
  projectRevision?: number;
  graph: Graph;
  jobs: GraphJob[];
  workerOnline: boolean;
  history: {
    revision: number;
    action: string;
    actor: string;
    createdAt: string;
  }[];
  staleBridgeIds: string[];
};
type ExportRecord = {
  id: string;
  filename: string;
  hash: string;
  size: number;
  revision: number;
  status: string;
  createdAt: string;
};
const stageNames: Record<string, string> = {
  retrieving: '读取原文',
  extracting: '提取中',
  validating: '核对关系支持性',
  persisting: '保存结果',
};
const supportNames = {
  supported: '依据支持',
  partial: '部分支持',
  conflict: '与依据冲突',
  unknown: '无法判断',
};
export function GraphWorkspace({
  project,
  aiConfigured,
  onSource,
  onUpload,
  onMatrix,
  onProject,
}: {
  project: Project;
  aiConfigured: boolean;
  onSource: (id: string, block?: string) => void;
  onUpload: () => void;
  onMatrix: (paperIds: string[], labels: string[]) => void;
  onProject: (project: Project) => void;
}) {
  const [bridgeReasons, setBridgeReasons] = useState<Record<string, string>>(
    {},
  );
  const [data, setData] = useState<GraphData>({
      graph: emptyGraph(),
      jobs: [],
      workerOnline: false,
      history: [],
      staleBridgeIds: [],
    }),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [query, setQuery] = useState(''),
    [type, setType] = useState('all'),
    [review, setReview] = useState('all'),
    [network, setNetwork] = useState('concept'),
    [mode, setMode] = useState('graph'),
    [focus, setFocus] = useState(''),
    [depth, setDepth] = useState(1),
    [selected, setSelected] = useState<string[]>([]),
    [edgeId, setEdgeId] = useState(''),
    [paperFilter, setPaperFilter] = useState('all'),
    [paperSelection, setPaperIds] = useState<string[] | null>(null);
  const paperIds = (
    paperSelection ?? project.state.papers.map((p) => p.id)
  ).filter((id) =>
    project.state.papers.some(
      (p) => p.id === id && p.coverage !== 'metadata' && p.blockCount > 0,
    ),
  );
  const [positions, setPositions] = useState<
      Record<string, { x: number; y: number }>
    >({}),
    [viewName, setViewName] = useState(''),
    [reason, setReason] = useState(''),
    [editType, setEditType] = useState<Relation['type']>('uses'),
    [condition, setCondition] = useState(''),
    [support, setSupport] = useState<Relation['support']>('unknown'),
    [editName, setEditName] = useState(''),
    [aliases, setAliases] = useState(''),
    [entityType, setEntityType] = useState<Entity['type']>('concept'),
    [entityDomain, setEntityDomain] = useState(''),
    [entityDefinition, setEntityDefinition] = useState(''),
    [editEntity, setEditEntity] = useState(false),
    [mergeOpen, setMergeOpen] = useState(false),
    [historyOpen, setHistoryOpen] = useState(false),
    [exportsOpen, setExportsOpen] = useState(false),
    [exports, setExports] = useState<ExportRecord[]>([]),
    [downloaded, setDownloaded] = useState<string[]>([]),
    [evidenceEdit, setEvidenceEdit] = useState(''),
    [quote, setQuote] = useState('');
  const [linkEvidence, setLinkEvidence] = useState(''),
    [linkField, setLinkField] = useState(''),
    [linkValue, setLinkValue] = useState(''),
    [linkReason, setLinkReason] = useState('');
  const [recordEvidence, setRecordEvidence] = useState('');
  const load = useCallback(async () => {
    const result = await request<GraphData>(
      `/api/projects/${project.id}/graph`,
    );
    setData(result);
    if (
      result.projectRevision !== undefined &&
      result.projectRevision > project.revision
    ) {
      const latest = await request<{ project: Project }>(
        `/api/projects/${project.id}`,
      );
      onProject(latest.project);
    }
    setLoading(false);
    return result;
  }, [project.id, project.revision, onProject]);
  useEffect(() => {
    let live = true;
    const refresh = () =>
      load().catch((e) => {
        if (live) {
          setError(e.message);
          setLoading(false);
        }
      });
    void refresh();
    const interval = setInterval(() => void refresh(), 5000);
    return () => {
      live = false;
      clearInterval(interval);
    };
  }, [load]);
  async function run(label: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(label);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function mutate(body: Record<string, unknown>) {
    await request(`/api/projects/${project.id}/graph`, {
      method: 'PATCH',
      body: JSON.stringify({ ...body, revision: data.graph.revision }),
    });
    await load();
    setNotice('已保存，审核及版本记录已保留。');
  }
  const g = data.graph,
    relations = useMemo(
      () => visibleRelations(g, network, review),
      [g, network, review],
    );
  const candidates = g.entities.filter(
    (e) =>
      !e.mergedInto &&
      (review === 'all' ||
        relations.some((r) => r.source === e.id || r.target === e.id)) &&
      (type === 'all' || e.type === type) &&
      (paperFilter === 'all' ||
        e.paperIds.includes(paperFilter) ||
        g.entities.some(
          (x) =>
            activeEntity(g, x.id) === e.id && x.paperIds.includes(paperFilter),
        )) &&
      (!query ||
        [e.name, ...e.aliases, e.definition]
          .join(' ')
          .toLowerCase()
          .includes(query.toLowerCase())),
  );
  const root = candidates.some((e) => e.id === focus)
    ? focus
    : candidates.find((e) => e.type === 'problem')?.id ||
      candidates[0]?.id ||
      '';
  const nearby = neighborhood(relations, root, depth, 35),
    nodes = candidates.filter((e) => nearby.has(e.id));
  const shown = new Set(nodes.map((e) => e.id)),
    edges = relations.filter((r) => shown.has(r.source) && shown.has(r.target)),
    rawEdge = g.relations.find((r) => r.id === edgeId),
    edge = rawEdge
      ? {
          ...rawEdge,
          ...(relationTypeIssue(g, rawEdge)
            ? {
                support: 'unknown' as const,
                reason: relationTypeIssue(g, rawEdge),
              }
            : {}),
        }
      : undefined,
    entity = g.entities.find((e) => e.id === selected[0]);
  const counts = jobCounts(
      data.jobs.filter((j) => j.batchId === data.jobs[0]?.batchId),
    ),
    active = data.jobs.some((j) => ['queued', 'running'].includes(j.status));
  const path =
    selected.length === 2
      ? evidencePath(visibleRelations(g), selected[0], selected[1])
      : undefined;
  const name = (id: string) =>
    g.entities.find((e) => e.id === activeEntity(g, id))?.name || '未知实体';
  const isolatedCount = g.isolated?.length ?? 0;
  const reviewCount = g.relations.filter(
    (r) => r.typeReview?.status === 'needs-review',
  ).length;
  // 引用只在旧版解析的双栏页里连贯：必须让用户看到「原文摘录待核对」。
  const excerptReview = g.evidence.filter((e) => e.excerptNeedsReview);
  function pick(e: Entity) {
    setSelected((ids) =>
      ids.includes(e.id)
        ? ids.filter((id) => id !== e.id)
        : [...ids.slice(-1), e.id],
    );
    setEdgeId('');
    setEditEntity(false);
  }
  function chooseEdge(r: Relation) {
    setEdgeId(r.id);
    setEditType(r.type);
    setCondition(r.condition);
    setSupport(r.support);
    setReason('');
  }
  function xy(id: string, _index: number) {
    const index = nodes
      .filter((e) => e.id !== root)
      .findIndex((e) => e.id === id);
    return (
      positions[id] || {
        x:
          id === root
            ? 460
            : 460 +
              310 *
                Math.cos((index * 2 * Math.PI) / Math.max(nodes.length - 1, 1)),
        y:
          id === root
            ? 285
            : 285 +
              210 *
                Math.sin((index * 2 * Math.PI) / Math.max(nodes.length - 1, 1)),
      }
    );
  }
  async function loadExports() {
    setExports(
      await request<ExportRecord[]>(`/api/projects/${project.id}/exports`),
    );
  }
  const sourceEvidence = edge
    ? g.evidence.filter((e) => edge.evidenceIds.includes(e.id))
    : entity
      ? g.evidence.filter((e) =>
          g.mentions.some(
            (m) =>
              activeEntity(g, m.entityId) === entity.id &&
              m.evidenceId === e.id,
          ),
        )
      : [];
  const selectedRecordEvidence = g.evidence.find(
    (e) => e.id === recordEvidence,
  );
  return (
    <div className="graph-workspace">
      {selectedRecordEvidence && (
        <GraphEvidenceUse
          key={recordEvidence}
          project={project}
          evidence={selectedRecordEvidence}
          graphRevision={g.revision}
          onSaved={load}
          onClose={() => setRecordEvidence('')}
        />
      )}
      <div className="graph-topbar">
        <div className="row">
          <Badge kind="confirmed">图谱 v{g.revision}</Badge>
          <span>
            {g.entities.filter((e) => !e.mergedInto).length} 个实体 ·{' '}
            {g.relations.length} 条关系
          </span>
        </div>
        <div className="row">
          <Button
            variant="outline"
            disabled={!!busy}
            onClick={() =>
              run('刷新图谱', async () => {
                await load();
              })
            }
          >
            <RefreshCw />
            刷新
          </Button>
          <Button variant="outline" onClick={() => setHistoryOpen(true)}>
            <History />
            版本
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              run('读取导出记录', async () => {
                await loadExports();
                setExportsOpen(true);
              })
            }
          >
            <Download />
            导出中心
          </Button>
        </div>
      </div>
      {error && (
        <div role="alert" className="notice notice-error">
          {error}
        </div>
      )}
      {notice && <output className="notice notice-success">{notice}</output>}
      {busy && <output className="busy-strip">{busy}…</output>}
      <div className="graph-layout">
        <aside className="graph-library">
          <h2>
            <FileText size={18} /> 文献与筛选
          </h2>
          <p className="secondary">
            {project.question || '在课题设置中补充研究问题。'}
          </p>
          <div className="graph-paper-list">
            {project.state.papers.map((p) => (
              <label className="paper-check" key={p.id}>
                <Checkbox
                  disabled={p.coverage === 'metadata' || p.blockCount === 0}
                  checked={paperIds.includes(p.id)}
                  onCheckedChange={(checked) =>
                    setPaperIds((ids) =>
                      checked
                        ? [...(ids ?? paperIds), p.id]
                        : (ids ?? paperIds).filter((id) => id !== p.id),
                    )
                  }
                />
                <span>
                  {p.title}
                  <small>
                    {p.sample
                      ? '虚构演示材料 · '
                      : p.coverage === 'abstract'
                        ? '仅摘要 · '
                        : p.coverage === 'metadata'
                          ? '仅书目 · '
                          : ''}
                    {g.coverage.some((c) => c.paperId === p.id)
                      ? '已构图'
                      : '尚未构图'}{' '}
                    · {p.pages} 页
                    {p.blockCount === 0 && ' · 无可引用文字，请先核对 OCR'}
                  </small>
                </span>
              </label>
            ))}
          </div>
          {project.state.papers.some((p) => p.coverage === 'metadata') && (
            <p className="secondary">
              仅书目条目不能构图，请先补充摘要或全文。当前选择仅包含有原文材料的文献。
            </p>
          )}
          <Button
            disabled={
              !!busy ||
              !aiConfigured ||
              !paperIds.length ||
              active ||
              !data.workerOnline
            }
            onClick={() =>
              run('提交构图任务', async () => {
                await request(`/api/projects/${project.id}/graph`, {
                  method: 'POST',
                  body: JSON.stringify({ task: 'extract', paperIds }),
                });
                await load();
                setNotice(
                  '已提交后台。可关闭页面，重新打开查看结果。重新构图会保留已有核对内容。',
                );
              })
            }
          >
            <Sparkles />
            自动构图（{paperIds.length} 篇）
          </Button>
          <output className="graph-executor">
            <span className={data.workerOnline ? 'live-dot' : 'offline-dot'} />
            {data.workerOnline ? '后台执行器已连接' : '后台执行器未连接'}
            {!aiConfigured && ' · 待配置模型密钥'}
          </output>
          <Label title="搜索节点">
            <div className="searchbox">
              <Search size={16} />
              <Input
                aria-label="搜索图谱节点"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="名称、别名或定义"
              />
            </div>
          </Label>
          <Picker
            label="节点类型"
            value={type}
            onChange={setType}
            options={[
              { value: 'all', label: '全部节点类型' },
              ...Object.entries(nodeNames).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
          />
          <Picker
            label="核对状态"
            value={review}
            onChange={setReview}
            options={[
              { value: 'all', label: '候选与已核对' },
              ...['confirmed', 'candidate', 'stale'].map((value) => ({
                value,
                label: reviewNames[value as keyof typeof reviewNames],
              })),
            ]}
          />
          <Picker
            label="来源文献"
            value={paperFilter}
            onChange={setPaperFilter}
            options={[
              { value: 'all', label: '全部文献来源' },
              ...project.state.papers.map((p) => ({
                value: p.id,
                label: p.title,
              })),
            ]}
          />
          <p className="secondary">
            筛选结果 {candidates.length} /{' '}
            {g.entities.filter((e) => !e.mergedInto).length} 个实体
          </p>
          {candidates.length > 0 && (
            <Picker
              label="图谱中心"
              value={root}
              onChange={(id) => {
                setFocus(id);
                setDepth(1);
              }}
              options={candidates.map((e) => ({
                value: e.id,
                label: `${nodeNames[e.type]} · ${e.name}`,
              }))}
            />
          )}
          <details>
            <summary>已保存的探索视图（{g.views.length}）</summary>
            {g.views.map((v) => (
              <Button
                key={v.id}
                variant="ghost"
                onClick={() => {
                  setFocus(v.focus);
                  setQuery(v.query);
                  setType(v.type);
                  setReview(v.review);
                  setNetwork(v.network);
                  setDepth(v.depth);
                  setPositions(v.positions);
                }}
              >
                {v.name}
              </Button>
            ))}
            <Input
              aria-label="探索视图名称"
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              placeholder="视图名称"
              maxLength={80}
            />
            <Button
              variant="outline"
              disabled={!!busy || !viewName.trim()}
              onClick={() =>
                run('保存探索视图', () =>
                  mutate({
                    action: 'view.save',
                    name: viewName,
                    focus: root,
                    query,
                    type,
                    review,
                    network,
                    depth,
                    positions,
                  }),
                )
              }
            >
              <Save />
              保存当前视图
            </Button>
          </details>
        </aside>
        <section className="graph-stage">
          <div className="graph-stage-bar">
            <Tabs value={network} onValueChange={setNetwork}>
              <TabsList>
                <TabsTrigger value="concept">概念与方法</TabsTrigger>
                <TabsTrigger value="evidence">结论与证据</TabsTrigger>
                <TabsTrigger value="citation">文献引用</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="row">
              <Button
                variant={mode === 'graph' ? 'secondary' : 'ghost'}
                aria-label="图谱视图"
                onClick={() => setMode('graph')}
              >
                <Network />
              </Button>
              <Button
                variant={mode === 'list' ? 'secondary' : 'ghost'}
                aria-label="关系列表视图"
                onClick={() => setMode('list')}
              >
                <List />
              </Button>
            </div>
          </div>
          {network === 'citation' ? (
            <CitationNetwork project={project} onSource={onSource} />
          ) : loading ? (
            <Empty title="读取图谱">
              <p>正在载入已有记录…</p>
            </Empty>
          ) : !g.entities.length ? (
            <Empty
              title={
                project.state.papers.length
                  ? '从原文建立第一张图谱'
                  : '导入文献，开始探索'
              }
            >
              <div className="graph-empty-icon">
                <Network size={48} />
              </div>
              <p>抽取问题、方法与结论，沿每条关系核对原文依据。</p>
              <p>候选图谱将在真实抽取后出现。</p>
              <Button onClick={onUpload}>上传 PDF / TXT</Button>
            </Empty>
          ) : !nodes.length ? (
            <Empty title="没有符合筛选条件的节点">
              <p>请调整搜索、类型或来源筛选。</p>
            </Empty>
          ) : mode === 'graph' ? (
            <div className="graph-canvas">
              <div className="graph-drawing">
                <svg
                  viewBox="0 0 920 580"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <defs>
                    <marker
                      id="graph-arrow"
                      viewBox="0 0 10 10"
                      refX="9"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
                    </marker>
                  </defs>
                  {edges.map((r) => {
                    const a = xy(r.source, 0),
                      b = xy(r.target, 0);
                    return (
                      <g
                        key={r.id}
                        className={
                          'graph-edge ' +
                          (r.status === 'confirmed' ? 'checked' : '') +
                          ' ' +
                          (r.id === edgeId ? 'selected' : '')
                        }
                      >
                        <line
                          x1={a.x}
                          y1={a.y}
                          x2={b.x + (a.x - b.x) * 0.17}
                          y2={b.y + (a.y - b.y) * 0.17}
                          markerEnd="url(#graph-arrow)"
                        />
                      </g>
                    );
                  })}
                </svg>
                {edges.map((r) => {
                  const a = xy(r.source, 0),
                    b = xy(r.target, 0);
                  return (
                    <button
                      key={r.id}
                      className="graph-edge-label"
                      style={{
                        left: ((a.x + b.x) / 2 / 920) * 100 + '%',
                        top: (((a.y + b.y) / 2 - 45) / 580) * 100 + '%',
                      }}
                      aria-label={
                        name(r.source) +
                        ' ' +
                        relationNames[r.type] +
                        ' ' +
                        name(r.target)
                      }
                      onClick={() => chooseEdge(r)}
                    >
                      {relationNames[r.type]}
                    </button>
                  );
                })}
                {nodes.map((e, i) => {
                  const pos = xy(e.id, i);
                  return (
                    <button
                      key={e.id}
                      aria-label={nodeNames[e.type] + '：' + e.name}
                      aria-pressed={selected.includes(e.id)}
                      className={
                        'graph-html-node node-' +
                        e.type +
                        ' ' +
                        (selected.includes(e.id) ? 'selected' : '')
                      }
                      title={e.name + ' · ' + e.definition}
                      style={{
                        left: (pos.x / 920) * 100 + '%',
                        top: (pos.y / 580) * 100 + '%',
                      }}
                      onClick={() => pick(e)}
                      onKeyDown={(event) => {
                        if (event.key.startsWith('Arrow')) {
                          event.preventDefault();
                          const dx =
                              event.key === 'ArrowLeft'
                                ? -25
                                : event.key === 'ArrowRight'
                                  ? 25
                                  : 0,
                            dy =
                              event.key === 'ArrowUp'
                                ? -25
                                : event.key === 'ArrowDown'
                                  ? 25
                                  : 0;
                          setPositions((p) => ({
                            ...p,
                            [e.id]: {
                              x: Math.max(100, Math.min(800, pos.x + dx)),
                              y: Math.max(50, Math.min(520, pos.y + dy)),
                            },
                          }));
                        }
                      }}
                    >
                      <small>{nodeNames[e.type]}</small>
                      <span>{e.name}</span>
                    </button>
                  );
                })}
              </div>
              <div className="graph-canvas-caption">
                实线：人工核对 · 虚线：候选 / 待复查 · 选中节点后方向键移动位置
              </div>
            </div>
          ) : (
            <div className="graph-relation-list">
              {edges.length ? (
                edges.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => chooseEdge(r)}
                    className="graph-relation-row"
                  >
                    <span>
                      {name(r.source)} <ArrowRight size={14} /> {name(r.target)}
                    </span>
                    <span>
                      {relationNames[r.type]} · {reviewNames[r.status]}
                    </span>
                    <small>{r.condition || '条件未说明'}</small>
                  </button>
                ))
              ) : (
                <p className="padded secondary">这个局部范围没有关系记录。</p>
              )}
              {nodes.map((e) => (
                <button
                  key={e.id}
                  className="graph-list-node"
                  onClick={() => pick(e)}
                >
                  {nodeNames[e.type]} · {e.name}
                </button>
              ))}
            </div>
          )}
          {network !== 'citation' && (
            <div className="graph-stage-footer">
              <span>
                {nodes.length} 个可见节点 · {depth} 层邻居（最多35个）
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={depth >= 3}
                onClick={() => setDepth((d) => d + 1)}
              >
                <Expand />
                展开一层
              </Button>
            </div>
          )}
          {network !== 'citation' && selected.length > 0 && (
            <div className="graph-selection">
              <strong>已选 {selected.map(name).join(' / ')}</strong>
              <div className="row">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setFocus(selected[0]);
                    setDepth(1);
                  }}
                >
                  以此为中心
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    onMatrix(entityPaperIds(g, selected), selected.map(name))
                  }
                >
                  文献矩阵
                </Button>
                {selected.length === 2 && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setReason('');
                        setMergeOpen(true);
                      }}
                    >
                      <GitMerge />
                      合并预览
                    </Button>
                    <Button
                      size="sm"
                      disabled={
                        !!busy || active || !aiConfigured || !data.workerOnline
                      }
                      onClick={() =>
                        run('提交桥接分析', async () => {
                          await request(`/api/projects/${project.id}/graph`, {
                            method: 'POST',
                            body: JSON.stringify({
                              task: 'bridge',
                              source: selected[0],
                              target: selected[1],
                            }),
                          });
                          await load();
                        })
                      }
                    >
                      <Link2 />
                      生成桥接假设
                    </Button>
                  </>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelected([])}
                >
                  清除选择
                </Button>
              </div>
              {selected.length === 2 && (
                <p className="help-text">
                  有方向的已核对证据路径（最多4条边）：
                  {path === null
                    ? '未找到；这不代表学界不存在连接。'
                    : path?.length
                      ? path
                          .map(
                            (r) =>
                              `${name(r.source)} → ${relationNames[r.type]} → ${name(r.target)}`,
                          )
                          .join('；')
                      : '同一实体'}
                  。支持关系链本身不证明传递性。
                </p>
              )}
            </div>
          )}
          {selected.length === 2 && (
            <div className="graph-compare">
              {selected.map((id) => {
                const e = g.entities.find((e) => e.id === id)!;
                return (
                  <div key={id}>
                    <h3>{e.name}</h3>
                    <p>
                      {nodeNames[e.type]} · {e.domain}
                    </p>
                    <p>{e.definition}</p>
                    <small>
                      来源：
                      {project.state.papers
                        .filter((p) => e.paperIds.includes(p.id))
                        .map((p) => p.title)
                        .join('；')}
                    </small>
                    <p>
                      适用条件：
                      {g.relations
                        .filter((r) => r.source === e.id)
                        .map((r) => r.condition)
                        .filter(Boolean)
                        .join('；') || '未知'}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </section>
        <aside className="graph-inspector">
          <h2>关系与原文证据</h2>
          {edge ? (
            <>
              <Badge
                kind={edge.status === 'confirmed' ? 'confirmed' : 'pending'}
              >
                {reviewNames[edge.status]}
              </Badge>
              <h3>
                {name(edge.source)} <ArrowRight size={16} /> {name(edge.target)}
              </h3>
              <p>
                {relationNames[edge.type]} · {edge.condition || '条件未知'}
              </p>
              <div className="graph-support">
                <strong>{supportNames[edge.support]}</strong>
                <p>{edge.reason}</p>
                <small>
                  摘录位置有效不等于关系已被证实。模型判断仍需人工核对。
                </small>
              </div>
              <Label title="审核或纠正理由">
                <Textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  maxLength={1500}
                />
              </Label>
              <div className="row">
                <Button
                  disabled={
                    !!busy || !reason.trim() || edge.support !== 'supported'
                  }
                  onClick={() =>
                    run('确认关系', () =>
                      mutate({
                        action: 'relation.review',
                        id: edge.id,
                        status: 'confirmed',
                        reason,
                      }),
                    )
                  }
                >
                  <Check />
                  确认
                </Button>
                <Button
                  variant="outline"
                  disabled={!!busy || !reason.trim()}
                  onClick={() =>
                    run('拒绝关系', () =>
                      mutate({
                        action: 'relation.review',
                        id: edge.id,
                        status: 'rejected',
                        reason,
                      }),
                    )
                  }
                >
                  <X />
                  拒绝
                </Button>
              </div>
              <details>
                <summary>纠正关系及条件</summary>
                <Picker
                  label="关系类型"
                  value={editType}
                  onChange={(v) => setEditType(v as Relation['type'])}
                  options={Object.entries(relationNames).map(
                    ([value, label]) => ({ value, label }),
                  )}
                />
                <Textarea
                  aria-label="关系适用条件"
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                  maxLength={1200}
                />
                <Picker
                  label="支持性"
                  value={support}
                  onChange={(v) => setSupport(v as Relation['support'])}
                  options={Object.entries(supportNames).map(
                    ([value, label]) => ({ value, label }),
                  )}
                />
                <Button
                  variant="outline"
                  disabled={!!busy || !reason.trim()}
                  onClick={() =>
                    run('纠正关系', () =>
                      mutate({
                        action: 'relation.correct',
                        id: edge.id,
                        type: editType,
                        condition,
                        support,
                        reason,
                      }),
                    )
                  }
                >
                  保存为待核对
                </Button>
              </details>
            </>
          ) : entity ? (
            <>
              <Badge>{nodeNames[entity.type]}</Badge>
              <h3>{entity.name}</h3>
              <p>{entity.definition}</p>
              <p className="secondary">
                {entity.domain} · 别名：{entity.aliases.join('、') || '暂无'}
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  setEditName(entity.name);
                  setAliases(entity.aliases.join('\n'));
                  setEntityType(entity.type);
                  setEntityDomain(entity.domain);
                  setEntityDefinition(entity.definition);
                  setReason('');
                  setEditEntity(true);
                }}
              >
                纠正实体信息
              </Button>
              {g.entities
                .filter((e) => e.mergedInto === entity.id)
                .map((e) => (
                  <div key={e.id}>
                    <p>已合并：{e.name}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!!busy}
                      onClick={() =>
                        run('拆分实体', () =>
                          mutate({
                            action: 'entity.split',
                            id: e.id,
                            reason:
                              '人工撤销实体合并，恢复原始提及与关系端点。',
                          }),
                        )
                      }
                    >
                      撤销此合并
                    </Button>
                  </div>
                ))}
            </>
          ) : (
            <p className="secondary">
              选择节点或关系，查看其原文提及、方向、适用条件与审核记录。
            </p>
          )}
          {sourceEvidence.map((e) => (
            <article className="graph-evidence-card" key={e.id}>
              <small>
                {project.state.papers.find((p) => p.id === e.paperId)?.title} ·
                第{e.page}页
              </small>
              <blockquote>{e.quote}</blockquote>
              <div className="row">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onSource(e.paperId, e.blockId)}
                >
                  定位原文
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEvidenceEdit(e.id);
                    setQuote(e.quote);
                    setReason('');
                  }}
                >
                  纠正摘录
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!!busy || !project.state.fields.length}
                  onClick={() => {
                    setLinkEvidence(e.id);
                    setLinkField(project.state.fields[0]?.id ?? '');
                    setLinkValue('');
                    setLinkReason('');
                  }}
                >
                  引用到表格
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!!busy}
                  onClick={() => setRecordEvidence(e.id)}
                >
                  引用到笔记 / 稿件
                </Button>
              </div>
              {project.state.cells
                .filter(
                  (c) =>
                    c.evidenceRef?.id === e.id ||
                    c.candidate?.evidenceRef?.id === e.id,
                )
                .map((c) => (
                  <p className="secondary" key={c.id}>
                    表格引用：
                    {
                      project.state.fields.find((f) => f.id === c.fieldId)?.name
                    }{' '}
                    ·{' '}
                    {c.evidenceRef?.id === e.id
                      ? c.sourceValid
                        ? '当前值'
                        : '当前值待复查'
                      : '候选'}
                  </p>
                ))}
              {project.state.notes
                .filter((n) => n.source?.graphEvidence?.id === e.id)
                .map((n) => (
                  <p className="secondary" key={n.id}>
                    笔记引用：{n.text.slice(0, 80)} ·{' '}
                    {n.sourceNeedsReview ? '待复查' : '已绑定'}
                  </p>
                ))}
              {(project.state.review.citations ?? [])
                .filter((c) => c.source.graphEvidence?.id === e.id)
                .map((c) => (
                  <p className="secondary" key={c.id}>
                    稿件引用：{c.text.slice(0, 80)} ·{' '}
                    {c.status === 'linked'
                      ? '已绑定'
                      : c.status === 'withdrawn'
                        ? '已撤回'
                        : '待复查'}
                  </p>
                ))}
              <details>
                <summary>来源版本</summary>
                {(project.state.answerEvidenceLinks ?? [])
                  .filter((l) => l.source.graphEvidence?.id === e.id)
                  .map((l) => (
                    <p key={l.answerId + ':' + l.sourceIndex}>
                      问答依据 {l.sourceIndex + 1} ·{' '}
                      {l.status === 'linked'
                        ? '已关联'
                        : l.status === 'withdrawn'
                          ? '已撤回'
                          : '待复查'}
                      （在阅读助手的已保存问答中核对）
                    </p>
                  ))}
                <small>
                  文献 SHA-256：{e.documentHash}
                  <br />
                  解析 SHA-256：{e.parseHash}
                  <br />
                  构图任务：{e.runId}
                </small>
              </details>
            </article>
          ))}
        </aside>
      </div>
      {!!data.jobs.length && (
        <section className="panel graph-jobs">
          <h2>后台任务</h2>
          <output>
            最近批次：已结束 {counts.ended}/{counts.total} · 成功{' '}
            {counts.succeeded} · 部分完成 {counts.partial} · 失败{' '}
            {counts.failed} · 取消 {counts.cancelled}
          </output>
          <details open={active || counts.failed > 0}>
            <summary>逐篇任务与尝试记录</summary>
            {data.jobs.map((j) => (
              <div className="graph-job-row" key={j.id}>
                <div>
                  <strong>
                    {project.state.papers.find((p) => p.id === j.paperId)
                      ?.title || '跨文献桥接'}
                  </strong>
                  <small>
                    {j.status} · {stageNames[j.stage]} · 已尝试{j.attempts}次 ·{' '}
                    {new Date(j.updatedAt).toLocaleTimeString('zh-CN')}
                  </small>
                  {j.error && <p className="error-text">{j.error}</p>}
                </div>
                {['queued', 'running'].includes(j.status) && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!busy}
                    onClick={() =>
                      run('取消任务', () =>
                        mutate({ action: 'job.cancel', id: j.id }),
                      )
                    }
                  >
                    取消
                  </Button>
                )}
                {j.status === 'failed' && j.errorKind !== 'stale_input' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!busy}
                    onClick={() =>
                      run('重新排队', () =>
                        mutate({ action: 'job.retry', id: j.id }),
                      )
                    }
                  >
                    重试
                  </Button>
                )}
              </div>
            ))}
          </details>
        </section>
      )}
      <section className="panel graph-bridges">
        <h2>跨学科桥接 · 待验证假设</h2>
        {!g.bridges.length ? (
          <p className="secondary">
            选择不同文献中的两个节点，检查概念映射、条件差异与最小验证实验。证据不足时可以没有建议。
          </p>
        ) : (
          g.bridges.map((b) => (
            <article key={b.id}>
              <div className="row">
                <Badge>
                  {data.staleBridgeIds.includes(b.id)
                    ? '课题条件已变化'
                    : {
                        candidate: '候选假设',
                        explore: '值得探索',
                        tried: '已尝试',
                        unsuitable: '不适用',
                        stale: '依据已变化',
                      }[b.status]}
                </Badge>
                <strong>{b.question}</strong>
              </div>
              <h3>
                {name(b.source)} ↔ {name(b.target)}
              </h3>
              <dl>
                <dt>概念映射</dt>
                <dd>{b.mapping}</dd>
                <dt>条件差异</dt>
                <dd>{b.differences}</dd>
                <dt>反例与失败风险</dt>
                <dd>{b.risks}</dd>
                <dt>最小验证实验</dt>
                <dd>{b.experiment}</dd>
              </dl>
              <div>
                {b.evidenceIds.map((id) => {
                  const e = g.evidence.find((e) => e.id === id);
                  return e ? (
                    <Button
                      key={id}
                      variant="ghost"
                      size="sm"
                      onClick={() => onSource(e.paperId, e.blockId)}
                    >
                      来源：
                      {
                        project.state.papers.find((p) => p.id === e.paperId)
                          ?.title
                      }{' '}
                      · p{e.page}
                    </Button>
                  ) : null;
                })}
              </div>
              <p>{b.reason}</p>
              <Observations
                project={project}
                onProject={onProject}
                bridgeId={b.id}
                onChanged={load}
              />
              <Label title="验证反馈及原因">
                <Textarea
                  value={bridgeReasons[b.id] || ''}
                  onChange={(e) =>
                    setBridgeReasons((r) => ({ ...r, [b.id]: e.target.value }))
                  }
                  rows={2}
                />
              </Label>
              <div className="row">
                {(['explore', 'tried', 'unsuitable'] as const).map((status) => (
                  <Button
                    key={status}
                    variant="outline"
                    size="sm"
                    disabled={
                      !!busy ||
                      !(bridgeReasons[b.id] || '').trim() ||
                      b.status === 'stale' ||
                      data.staleBridgeIds.includes(b.id)
                    }
                    onClick={() =>
                      run('保存验证反馈', () =>
                        mutate({
                          action: 'bridge.review',
                          id: b.id,
                          status,
                          reason: bridgeReasons[b.id],
                        }),
                      )
                    }
                  >
                    {
                      {
                        explore: '值得探索',
                        tried: '已尝试',
                        unsuitable: '不适用',
                      }[status]
                    }
                  </Button>
                ))}
              </div>
            </article>
          ))
        )}
      </section>
      <details className="panel graph-coverage">
        <summary>
          构图覆盖与解析限制（{g.coverage.length} 次）
          {isolatedCount + reviewCount + excerptReview.length > 0
            ? ` · 隔离候选 ${isolatedCount} · 需复核关系 ${reviewCount} · 原文摘录待核对 ${excerptReview.length}`
            : ''}
        </summary>
        {excerptReview.length > 0 && (
          <div className="isolated-list">
            <strong>解析版本较旧，建议核对原文（{excerptReview.length} 条）</strong>
            <p className="import-log-meta">
              这些引用来自**旧版解析**的双栏页面。系统在这类页面上可能读不出连贯原文，
              因此请对照原 PDF 核对；重新导入该文献即可升级到新版解析。
              （实测：本机 104 条引用里 14 条确实读不出连贯原文，因此这里不做逐条判定，
              只作整体提示。）
            </p>
            {excerptReview.slice(0, 10).map((e) => (
              <div key={e.id} className="isolated-row">
                <div>
                  <span className="import-badge import-needs-review">解析较旧</span>
                  <strong>
                    {project.state.papers.find((p) => p.id === e.paperId)?.title ?? e.paperId}
                  </strong>
                  <span className="import-log-meta">第 {e.page} 页 · 双栏</span>
                </div>
                <div className="import-log-message">{String(e.quote).slice(0, 140)}</div>
              </div>
            ))}
          </div>
        )}
        {isolatedCount > 0 && (
          <div className="isolated-list">
            <strong>被隔离的候选（不是已确认事实）</strong>
            <p className="import-log-meta">
              这些候选没有通过原文证据校验，因此没有写入图谱。用它区分「论文未报告」与「系统提取后未通过校验」。
            </p>
            {g.isolated
              .slice()
              .reverse()
              .slice(0, 20)
              .map((c, i) => (
                <div key={`${c.paperId}-${i}`} className="isolated-row">
                  <div>
                    <span className="import-badge import-failed">
                      {REJECT_RULES[c.rule] ?? c.rule}
                    </span>
                    <strong>{c.label}</strong>
                    <span className="import-log-meta">
                      {c.paperTitle}
                      {c.page ? ` · 第 ${c.page} 页` : ''}
                      {c.at ? ` · ${String(c.at).replace('T', ' ').slice(0, 19)}` : ''}
                    </span>
                  </div>
                  <div className="import-log-message">{c.reason}</div>
                  {c.quote && (
                    <div className="import-log-meta">
                      候选摘录：{String(c.quote).slice(0, 140)}
                    </div>
                  )}
                </div>
              ))}
          </div>
        )}
        {reviewCount > 0 && (
          <div className="isolated-list">
            <strong>关系动作需复核（{reviewCount} 条）</strong>
            <p className="import-log-meta">
              这些关系的类型没有准确表达原文动作（例如把「在某数据集上评估」写成「使用」），或依据只被部分支持。
              系统只做标记，不会改写原关系。
            </p>
            {g.relations
              .filter((r) => r.typeReview?.status === 'needs-review')
              .slice(0, 20)
              .map((r) => (
                <div key={r.id} className="isolated-row">
                  <div>
                    <span className="import-badge import-needs-review">需复核</span>
                    <strong>
                      {name(r.source)} —{r.type}→ {name(r.target)}
                    </strong>
                    {r.typeReview?.suggested && (
                      <span className="import-log-meta">
                        建议改为「{r.typeReview.suggested}」
                      </span>
                    )}
                  </div>
                  <div className="import-log-message">{r.typeReview?.reason}</div>
                </div>
              ))}
          </div>
        )}
        {g.coverage.map((c) => (
          <div key={c.runId}>
            <strong>
              {project.state.papers.find((p) => p.id === c.paperId)?.title}
            </strong>
            <p>
              已提供 {c.blockIds.length}/{c.totalBlocks} 块 · 无文本页：
              {c.missingPages.join('、') || '无'}。提供全部文字不等于理解全文。
            </p>
            <p>{c.warning}</p>
          </div>
        ))}
      </details>
      <Modal
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        title="实体合并预览"
        description="原始提及和关系端点保留，可在目标实体侧栏撤销合并。"
      >
        {selected.length === 2 && (
          <>
            <p>
              将「{name(selected[0])}」归并到「{name(selected[1])}」。影响{' '}
              {
                g.relations.filter(
                  (r) => r.source === selected[0] || r.target === selected[0],
                ).length
              }{' '}
              条原始关系；相关桥接会标为待复查。
            </p>
            <Label title="消歧依据">
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Label>
            <Button
              disabled={!!busy || !reason.trim()}
              onClick={() =>
                run('合并实体', async () => {
                  await mutate({
                    action: 'entity.merge',
                    source: selected[0],
                    target: selected[1],
                    reason,
                  });
                  setSelected([selected[1]]);
                  setMergeOpen(false);
                })
              }
            >
              确认合并并记录依据
            </Button>
          </>
        )}
      </Modal>
      <Modal
        open={editEntity}
        onClose={() => setEditEntity(false)}
        title="纠正实体信息"
        description="修改名称、类型或定义后，相关关系和桥接会标为待复查；原始提及与证据保留。"
      >
        <Label title="规范名称">
          <Input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
          />
        </Label>
        <Label title="别名（每行一项）">
          <Textarea
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
          />
        </Label>
        <Picker
          label="实体类型"
          value={entityType}
          onChange={(value) => setEntityType(value as Entity['type'])}
          options={Object.entries(nodeNames).map(([value, label]) => ({
            value,
            label,
          }))}
        />
        <Label title="所属领域">
          <Input
            value={entityDomain}
            onChange={(e) => setEntityDomain(e.target.value)}
            maxLength={500}
          />
        </Label>
        <Label title="定义与适用含义">
          <Textarea
            value={entityDefinition}
            onChange={(e) => setEntityDefinition(e.target.value)}
            maxLength={2000}
          />
        </Label>
        <Label title="纠正依据">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Label>
        <Button
          disabled={!!busy || !reason.trim() || !editName.trim()}
          onClick={() =>
            run('保存实体纠正', async () => {
              await mutate({
                action: 'entity.edit',
                id: entity?.id,
                name: editName,
                type: entityType,
                domain: entityDomain,
                definition: entityDefinition,
                aliases: aliases
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean),
                reason,
              });
              setEditEntity(false);
            })
          }
        >
          保存
        </Button>
      </Modal>
      <Modal
        open={!!evidenceEdit}
        onClose={() => setEvidenceEdit('')}
        title="纠正原文摘录"
        description="必须是同一原文区域的连续摘录。依赖这条证据的关系和桥接将标为待复查。"
      >
        <Textarea
          value={quote}
          onChange={(e) => setQuote(e.target.value)}
          rows={6}
        />
        <Label title="修改原因">
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Label>
        <Button
          disabled={!!busy || !reason.trim()}
          onClick={() =>
            run('保存原文纠正', async () => {
              await mutate({
                action: 'evidence.correct',
                id: evidenceEdit,
                quote,
                reason,
              });
              setEvidenceEdit('');
            })
          }
        >
          保存并标记依赖
        </Button>
      </Modal>
      <Modal
        open={!!linkEvidence}
        onClose={() => setLinkEvidence('')}
        title="引用证据到表格"
        description="选择字段并填写候选值。原值会保留，候选需在表格中逐项核对。"
      >
        <blockquote>
          {g.evidence.find((e) => e.id === linkEvidence)?.quote}
        </blockquote>
        <Label title="目标字段">
          <Picker
            label="选择目标字段"
            value={linkField}
            onChange={setLinkField}
            options={project.state.fields.map((f) => ({
              value: f.id,
              label: f.name,
            }))}
          />
        </Label>
        <p className="secondary">
          {project.state.fields.find((f) => f.id === linkField)?.definition}
        </p>
        <Label title="候选值">
          <Textarea
            value={linkValue}
            onChange={(e) => setLinkValue(e.target.value)}
            maxLength={1600}
          />
        </Label>
        <Label title="引用理由">
          <Textarea
            value={linkReason}
            onChange={(e) => setLinkReason(e.target.value)}
            maxLength={1200}
          />
        </Label>
        {error && <p className="error-text">{error}</p>}
        <Button
          disabled={
            !!busy || !linkField || !linkValue.trim() || !linkReason.trim()
          }
          onClick={() =>
            run('生成关联候选', async () => {
              await mutate({
                action: 'evidence.toCell',
                id: linkEvidence,
                fieldId: linkField,
                value: linkValue,
                reason: linkReason,
                projectRevision: project.revision,
              });
              setLinkEvidence('');
              setNotice('已生成关联候选，可在文献表格中逐项核对。');
            })
          }
        >
          生成待审核候选
        </Button>
      </Modal>
      <Modal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title="图谱版本与审核记录"
        wide
      >
        <div className="history-modal">
          {data.history.map((h) => (
            <details key={h.revision}>
              <summary>
                v{h.revision} · {new Date(h.createdAt).toLocaleString('zh-CN')}{' '}
                · {h.actor === 'executor' ? '后台抽取' : '人工操作'}
              </summary>
              <p className="graph-audit-text">{h.action}</p>
              <Button
                variant="outline"
                disabled={!!busy || h.revision === g.revision}
                onClick={() =>
                  run('恢复图谱版本', () =>
                    mutate({
                      action: 'graph.restore',
                      targetRevision: h.revision,
                    }),
                  )
                }
              >
                恢复为新版本（结论需复查）
              </Button>
            </details>
          ))}
        </div>
      </Modal>
      <Modal
        open={exportsOpen}
        onClose={() => setExportsOpen(false)}
        title="导出中心"
        description="包含当前图谱、证据、课题记录、审核事件及可用的模型输入输出；不包含PDF原件及旧图谱快照。"
        wide
      >
        <Button
          disabled={!!busy}
          onClick={() =>
            run('生成研究记录包', async () => {
              await request(`/api/projects/${project.id}/exports`, {
                method: 'POST',
                body: '{}',
              });
              await loadExports();
            })
          }
        >
          <Download />
          生成 JSON 记录包
        </Button>
        <div className="history-modal">
          {exports.map((e) => (
            <article className="graph-export" key={e.id}>
              <strong>{e.filename}</strong>
              <p>
                {new Date(e.createdAt).toLocaleString('zh-CN')} ·{' '}
                {(e.size / 1024).toFixed(1)} KB ·{' '}
                {downloaded.includes(e.id)
                  ? '已发起下载'
                  : {
                      generating: '生成中',
                      generated: '已生成',
                      failed: '生成失败',
                    }[e.status] || e.status}
              </p>
              <small>SHA-256：{e.hash || '尚未生成'}</small>
              <Button
                variant="outline"
                disabled={!!busy || e.status !== 'generated'}
                onClick={() =>
                  run('发起下载', async () => {
                    const response = await fetch(
                      `/api/projects/${project.id}/exports?download=${e.id}`,
                    );
                    if (!response.ok)
                      throw new Error('导出文件下载失败，请重新生成或重试。');
                    const blob = await response.blob();
                    downloadFile(e.filename, blob, 'application/json');
                    setDownloaded((ids) => [...ids, e.id]);
                    setNotice('已发起浏览器下载，请在浏览器下载记录中查看。');
                  })
                }
              >
                重新下载
              </Button>
            </article>
          ))}
        </div>
      </Modal>
    </div>
  );
}
