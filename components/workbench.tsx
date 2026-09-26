'use client';
/* oxlint-disable next/no-html-link-for-pages -- Authentication requires top-level navigation. */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  BookOpen,
  Table2,
  ChartNoAxesCombined,
  GitCompareArrows,
  Plus,
  ArrowUpRight,
  Layers3,
  Upload,
  Download,
  Search,
  Settings2,
  Sparkles,
  CheckCheck,
  Quote,
  RefreshCw,
  SlidersHorizontal,
  History,
  AlertCircle,
  LoaderCircle,
  X,
  FolderOpen,
  FileText,
  Link2,
  Network,
} from 'lucide-react';
import {
  Sidebar,
  SidebarProvider,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { runBatch } from '@/lib/batch';
import { Matrix, EvidenceSheet, Reader } from './literature';
import { Experiments } from './experiments';
import { Revisions } from './revisions';
import { GraphWorkspace } from './graph-workspace';
import { ScholarSearch } from './scholar-search';
import {
  Picker,
  Modal,
  Label,
  Badge,
  statusNames,
  request,
  downloadFile,
} from './common';
import { exportCSV, REJECT_RULES, type Project, type Job, type Cell } from '@/lib/domain';
import { parseDocument } from '@/lib/pdf-client';
import { selectMatrixPapers } from '@/lib/matrix-scope';
import { REASON_LABELS } from '@/lib/imports';
import { LIMITS, FILE_MB } from '@/lib/limits';
import { CandidateReview } from './candidate-review';

type Summary = {
  id: string;
  title: string;
  question: string;
  papers: number;
  updatedAt: string;
};
type AI = { configured: boolean; model: string; dailyLimit: number };
const nav = [
  {
    id: 'graph',
    label: '图谱探索',
    english: 'KNOWLEDGE GRAPH',
    icon: Network,
    description: '从文献原文发现连接，核对依据，保存可验证的研究假设。',
  },
  {
    id: 'search',
    label: '学术导航',
    english: 'LITERATURE DISCOVERY',
    icon: Search,
    description: '搜索真实学术文献，保留检索范围、元数据来源与全文可用性。',
  },
  {
    id: 'matrix',
    label: '文献表格',
    english: 'LITERATURE MATRIX',
    icon: Table2,
    description: '按研究问题比较文献，每一项信息都可回到原文。',
  },
  {
    id: 'reader',
    label: '文献阅读',
    english: 'READING & EVIDENCE',
    icon: BookOpen,
    description: '理解论文，记录疑问，让阅读围绕你的课题展开。',
  },
  {
    id: 'experiments',
    label: '实验与结果',
    english: 'EXPERIMENTS & CLAIMS',
    icon: ChartNoAxesCombined,
    description: '连接自己的实验数据、图表与论文中的结果描述。',
  },
  {
    id: 'revisions',
    label: '修改跟踪',
    english: 'REVISION TRACKER',
    icon: GitCompareArrows,
    description: '从修改意见到实际变化，逐条核对落实情况。',
  },
];

export default function Workbench() {
  const [guest, setGuest] = useState(false);
  const [candidateReviewOpen, setCandidateReviewOpen] = useState(false);
  const [projects, setProjects] = useState<Summary[]>([]),
    [project, setProject] = useState<Project | null>(null),
    [view, setView] = useState('graph'),
    [ai, setAI] = useState<AI>({
      configured: false,
      model: '',
      dailyLimit: 100,
    }),
    [usage, setUsage] = useState({ total: 0, inputTokens: 0, outputTokens: 0 }),
    [jobs, setJobs] = useState<Job[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(''),
    [notice, setNotice] = useState<{ text: string; error: boolean } | null>(
      null,
    ),
    [query, setQuery] = useState(''),
    [cellId, setCellId] = useState<string | null>(null),
    [paperId, setPaperId] = useState(''),
    [focusBlock, setFocusBlock] = useState(''),
    [focusVersion, setFocusVersion] = useState(0),
    [projectModal, setProjectModal] = useState(false),
    [editProject, setEditProject] = useState(false),
    [title, setTitle] = useState(''),
    [question, setQuestion] = useState(''),
    [profile, setProfile] = useState({
      equipment: '',
      currentMethod: '',
      constraints: '',
    }),
    [extractSelection, setExtractSelection] = useState<{
      projectId: string;
      ids: string[];
    } | null>(null),
    [graphScope, setGraphScope] = useState<{
      projectId: string;
      paperIds: string[];
      labels: string[];
    } | null>(null),
    [fieldModal, setFieldModal] = useState(false),
    [fieldId, setFieldId] = useState(''),
    [fieldName, setFieldName] = useState(''),
    [definition, setDefinition] = useState(''),
    [ruleModal, setRuleModal] = useState(false),
    [ruleField, setRuleField] = useState(''),
    [instruction, setInstruction] = useState(''),
    [settings, setSettings] = useState(false),
    [activity, setActivity] = useState(false),
    [importLogOpen, setImportLogOpen] = useState(false),
    [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const current = useRef<Project | null>(null),
    uploader = useRef<HTMLInputElement>(null);
  const section = nav.find((n) => n.id === view)!;
  const importLog = project?.state.importLog ?? [];
  const failedImports = importLog.filter((a) => a.status === 'failed').length;
  const rejectedCount = (project?.state.rejectedCandidates ?? []).length;
  const setCurrent = useCallback((p: Project) => {
    current.current = p;
    setProject(p);
  }, []);
  const updateCurrent = useCallback(
    (p: Project) => {
      if (
        current.current?.id === p.id &&
        p.revision >= current.current.revision
      )
        setCurrent(p);
    },
    [setCurrent],
  );
  const loadList = useCallback(async () => {
    const data = await request<{
      guest?: boolean;
      projects: Summary[];
      ai: AI;
      usage: typeof usage;
    }>('/api/projects');
    setGuest(!!data.guest);
    setProjects(data.projects);
    setAI(data.ai);
    setUsage(data.usage);
    return data.projects;
  }, []);
  const loadProject = useCallback(
    async (id: string) => {
      const data = await request<{ project: Project; jobs: Job[] }>(
        `/api/projects/${id}`,
      );
      setCurrent(data.project);
      setJobs(data.jobs);
      return data.project;
    },
    [setCurrent],
  );
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await loadList();
        if (!cancelled && list.length) await loadProject(list[0].id);
      } catch (e) {
        if (!cancelled) setNotice({ text: (e as Error).message, error: true });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadList, loadProject]);
  const selectedProjectId = project?.id;
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [view, selectedProjectId]);
  useEffect(() => {
    if (
      !selectedProjectId ||
      busy ||
      !jobs.some((j) => ['queued', 'running'].includes(j.status))
    )
      return;
    const id = selectedProjectId;
    const timer = setInterval(() => {
      if (current.current?.id === id)
        void request<{ project: Project; jobs: Job[] }>(`/api/projects/${id}`)
          .then((data) => {
            if (
              current.current?.id !== id ||
              data.project.revision < current.current.revision
            )
              return;
            setCurrent(data.project);
            setJobs(data.jobs);
          })
          .catch((e) => setNotice({ text: e.message, error: true }));
    }, 4000);
    return () => clearInterval(timer);
  }, [selectedProjectId, jobs, busy, setCurrent]);
  async function run(label: string, fn: () => Promise<void>) {
    if (busy) return false;
    setBusy(label);
    setNotice(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setNotice({ text: (e as Error).message, error: true });
      return false;
    } finally {
      setBusy('');
    }
  }
  async function mutate(action: Record<string, unknown>) {
    return run('正在保存…', async () => {
      const p = current.current;
      if (!p) throw new Error('请先选择课题。');
      const saved = await request<Project>(`/api/projects/${p.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...action, revision: p.revision }),
      });
      setCurrent(saved);
      await loadList();
      setNotice({ text: '已保存到课题。', error: false });
    });
  }
  function newProject(edit = false) {
    setEditProject(edit);
    setTitle(edit ? (project?.title ?? '') : '');
    setQuestion(edit ? (project?.question ?? '') : '');
    setProfile(
      edit
        ? (project?.state.profile ?? {
            equipment: '',
            currentMethod: '',
            constraints: '',
          })
        : { equipment: '', currentMethod: '', constraints: '' },
    );
    setProjectModal(true);
  }
  async function create(sample = false) {
    const ok = await run(
      sample ? '正在载入演示课题…' : '正在建立课题…',
      async () => {
        const p = await request<Project>('/api/projects', {
          method: 'POST',
          body: JSON.stringify({ sample, title, question, profile }),
        });
        setCurrent(p);
        setJobs([]);
        setPaperId('');
        setFocusBlock('');
        setView('matrix');
        await loadList();
      },
    );
    if (ok) setProjectModal(false);
  }
  function editField(id = '') {
    const f = project?.state.fields.find((f) => f.id === id);
    setFieldId(id);
    setFieldName(f?.name ?? '');
    setDefinition(f?.definition ?? '');
    setFieldModal(true);
  }
  function readPaper(id: string, block = '') {
    setPaperId(id);
    setFocusBlock(block);
    setFocusVersion((v) => v + 1);
    setView('reader');
  }
  /**
   * 客户端解析阶段就失败的导入（文件过大、字符超限等）不会产生任何
   * 服务端请求，因此需要主动回报，否则刷新后无从追溯。
   */
  async function reportImportFailure(file: File, error: unknown) {
    const p = current.current;
    if (!p) return;
    try {
      const updated = await request<Project>(
        `/api/projects/${p.id}/import-attempts`,
        {
          method: 'POST',
          body: JSON.stringify({
            filename: file.name.slice(0, 200),
            bytes: file.size,
            message:
              error instanceof Error && error.message
                ? error.message
                : '文件解析失败。',
          }),
        },
      );
      updateCurrent(updated);
    } catch {
      /* 记录失败不影响原始的报错展示 */
    }
  }
  async function uploadFiles(files: FileList | null) {
    if (!files || !current.current) return;
    const selected = Array.from(files);
    const uploadProjectId = current.current.id;
    await run('正在导入文献…', async () => {
      try {
        const result = await runBatch(selected, async (file) => {
          setUploadProgress(0);
          let parsed;
          try {
            parsed = await parseDocument(file, (page, total) => {
              setUploadProgress(Math.round((page / total) * 85));
            });
          } catch (e) {
            await reportImportFailure(file, e);
            throw e;
          }
          const { blocks, pageCount, parsing } = parsed;
          const p = current.current!;
          if (!p || p.id !== uploadProjectId)
            throw new Error('当前课题已切换，请返回原课题后重新上传。');
          const form = new FormData();
          form.append('file', file);
          form.append('blocks', JSON.stringify(blocks));
          form.append('revision', String(p.revision));
          form.append('pageCount', String(pageCount));
          form.append('parsing', JSON.stringify(parsing));
          let updated: Project;
          try {
            updated = await request<Project>(
              `/api/projects/${p.id}/documents`,
              { method: 'POST', body: form },
            );
          } catch (error) {
            // The server records failed imports, which advances the project revision.
            // Refresh before the next file in this batch uses that revision.
            if (current.current?.id === uploadProjectId) {
              try {
                await loadProject(uploadProjectId);
              } catch {
                /* Keep the original upload error visible. */
              }
            }
            throw error;
          }
          updateCurrent(updated);
          setUploadProgress(100);
        });
        await loadList();
        setNotice({
          text:
            `已导入 ${result.succeeded} / ${result.total} 篇文献。` +
            result.failures
              .map((f) => `${f.item.name}：${f.message}`)
              .join('；'),
          error: result.failures.length > 0,
        });
      } finally {
        setUploadProgress(null);
        if (uploader.current) uploader.current.value = '';
      }
    });
  }
  async function processJobs(ids: string[]) {
    const projectId = current.current!.id;
    for (const id of ids)
      await request('/api/jobs/' + id, {
        method: 'POST',
        body: JSON.stringify({ action: 'run' }),
      });
    await loadProject(projectId);
    setNotice({
      text: '任务已交给后台执行器，可关闭页面；结果提交后计入成功。',
      error: false,
    });
  }
  async function extract(fieldIds?: string[]) {
    await run('正在创建提取任务…', async () => {
      const p = current.current!;
      const data = await request<{ jobs: string[] }>(
        `/api/projects/${p.id}/extract`,
        {
          method: 'POST',
          body: JSON.stringify({
            fieldIds,
            paperIds: selectedForExtraction,
          }),
        },
      );
      await loadProject(p.id);
      await processJobs(data.jobs);
    });
  }
  const state = project?.state;
  const matrixScope = graphScope?.projectId === project?.id ? graphScope : null;
  const scopePapers =
    state?.papers.filter(
      (p) => !matrixScope || matrixScope.paperIds.includes(p.id),
    ) ?? [];
  const filteredMatrixPapers = project
    ? selectMatrixPapers(project, query, matrixScope?.paperIds)
    : [];
  const selectedForExtraction =
    extractSelection && project && extractSelection.projectId === project.id
      ? extractSelection.ids.filter((id) =>
          scopePapers.some((p) => p.id === id),
        )
      : scopePapers.map((p) => p.id);
  const pending =
      state?.cells.filter((c) => c.status !== 'confirmed').length ?? 0,
    confirmed =
      state?.cells.filter((c) => c.status === 'confirmed').length ?? 0,
    evidence = state?.cells.filter((c) => c.sourceValid).length ?? 0,
    candidates = state?.cells.filter((c) => c.candidate).length ?? 0;
  const activeJobs = jobs.filter((j) =>
    ['queued', 'running', 'failed'].includes(j.status),
  );
  const navDisabled = !!busy;
  return (
    <SidebarProvider
      style={{ '--sidebar-width': '238px' } as React.CSSProperties}
    >
      <Sidebar>
        <SidebarHeader>
          <div className="brand">
            <Layers3 />
            <span>
              研序<small>RESEARCH WORKSPACE</small>
            </span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <div className="nav-label">研究工作区</div>
          <SidebarMenu>
            {nav.map((n) => (
              <SidebarMenuItem key={n.id}>
                <SidebarMenuButton
                  disabled={navDisabled}
                  isActive={view === n.id}
                  onClick={() => setView(n.id)}
                >
                  <n.icon />
                  <span>{n.label}</span>
                  {n.id === 'matrix' && state && (
                    <span className="nav-count">{state.papers.length}</span>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          <div className="sidebar-divider" />
          <div className="nav-label">当前课题</div>
          <div className="project-switch">
            <Picker
              value={project?.id ?? ''}
              label="选择课题"
              disabled={!!busy}
              options={projects.map((p) => ({ value: p.id, label: p.title }))}
              onChange={(id) =>
                run('正在切换课题…', async () => {
                  await loadProject(id);
                  setPaperId('');
                  setFocusBlock('');
                  setQuery('');
                })
              }
            />
            <Button
              variant="ghost"
              disabled={!!busy}
              onClick={() => newProject()}
            >
              <Plus size={16} />
              新建课题
            </Button>
          </div>
          <div className="sidebar-context">
            <FolderOpen size={18} />
            <p>
              {project?.question || '围绕一个研究问题，积累你的文献与证据。'}
            </p>
            {project && (
              <button disabled={!!busy} onClick={() => newProject(true)}>
                编辑课题
                <ArrowUpRight size={12} />
              </button>
            )}
          </div>
        </SidebarContent>
        <SidebarFooter>
          <button className="model-state" onClick={() => setSettings(true)}>
            <span
              className={`connection-dot ${ai.configured ? 'connected' : ''}`}
            />
            <span>
              {ai.configured ? '模型已配置' : '模型未配置'}
              <small>{ai.configured ? ai.model : '可先阅读、核对与导出'}</small>
            </span>
            <Settings2 size={16} />
          </button>
          <div className="sidebar-note">让每一个结论都有迹可循。</div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="topbar">
          <SidebarTrigger />
          <span>我的研究</span>
          <span className="crumb">/</span>
          <strong className="breadcrumb-project">
            {project?.title || '新课题'}
          </strong>
          <div className="topbar-right">
            {project && (
              <span className="save-state">
                <CheckCheck size={15} />
                已保存 · V{project.revision}
              </span>
            )}
            <Button
              aria-label="查看活动记录"
              variant="ghost"
              size="icon"
              onClick={() => setActivity(true)}
            >
              <History />
            </Button>
            <span className="avatar">研</span>
          </div>
        </header>
        <main
          className={`workspace ${view === 'reader' ? 'reader-workspace' : ''}`}
        >
          <div className="page-heading">
            <div>
              <div className="eyebrow">{section.english}</div>
              <h1>{section.label}</h1>
              <p>{section.description}</p>
            </div>
            {project &&
              ['matrix', 'reader', 'graph', 'search'].includes(view) && (
                <div className="heading-actions">
                  {view === 'matrix' && (
                    <Button
                      variant="outline"
                      disabled={!filteredMatrixPapers.length}
                      onClick={() =>
                        downloadFile(
                          `${project.title}-文献表.csv`,
                          exportCSV({
                            ...project,
                            state: {
                              ...project.state,
                              papers: filteredMatrixPapers,
                            },
                          }),
                          'text/csv;charset=utf-8',
                        )
                      }
                    >
                      <Download />
                      导出当前表格（{filteredMatrixPapers.length} 篇）
                    </Button>
                  )}
                  <Button
                    disabled={!!busy}
                    onClick={() => uploader.current?.click()}
                  >
                    <Upload />
                    上传文献
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setImportLogOpen(true)}
                  >
                    <History />
                    导入与提取记录
                    {failedImports + rejectedCount > 0
                      ? `（${failedImports + rejectedCount} 条未通过）`
                      : ''}
                  </Button>
                </div>
              )}
          </div>
          {notice && (
            <div
              role={notice.error ? 'alert' : 'status'}
              className={`notice ${notice.error ? 'notice-error' : 'notice-success'}`}
            >
              <AlertCircle size={17} />
              <span>{notice.text}</span>
              {notice.error && notice.text.includes('登录') && (
                <a
                  className="login-link"
                  href="/signin-with-chatgpt?return_to=/"
                  target="_top"
                >
                  登录工作台
                </a>
              )}
              {notice.error && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    run('正在刷新…', async () => {
                      await loadList();
                      if (current.current)
                        await loadProject(current.current.id);
                    })
                  }
                >
                  刷新
                </Button>
              )}
              <button aria-label="关闭提示" onClick={() => setNotice(null)}>
                <X size={16} />
              </button>
            </div>
          )}
          {busy && (
            <div role="status" className="busy-strip">
              <LoaderCircle className="spin" size={16} />
              <span>{busy}</span>
              {uploadProgress !== null && (
                <Progress value={uploadProgress} className="upload-progress" />
              )}
            </div>
          )}
          {loading ? (
            <div className="loading-state">
              <LoaderCircle className="spin" />
              <p>正在载入你的研究资料…</p>
            </div>
          ) : !project ? (
            <div className="empty-project">
              <div className="empty-mark">
                <Table2 />
              </div>
              <h2>从一个研究问题开始</h2>
              <p>建立课题，上传论文，探索方法与结论的连接，并逐项核对原文。</p>
              <div className="row">
                <Button disabled={!!busy} onClick={() => newProject()}>
                  建立第一个课题
                  <ArrowUpRight />
                </Button>
                <Button
                  disabled={!!busy}
                  variant="outline"
                  onClick={() => create(true)}
                >
                  体验演示课题
                </Button>
              </div>
              <small className="secondary">
                演示课题使用明确标注的虚构文献与数据。
              </small>
              <div className="workflow-strip">
                <span>01 上传文献</span>
                <span>02 自动构图</span>
                <span>03 核对证据</span>
                <span>04 验证假设</span>
              </div>
            </div>
          ) : (
            <>
              {view === 'search' && (
                <ScholarSearch
                  key={project.id}
                  project={project}
                  onProject={updateCurrent}
                  aiConfigured={ai.configured}
                />
              )}
              {view === 'graph' && (
                <GraphWorkspace
                  key={project.id}
                  project={project}
                  onProject={updateCurrent}
                  aiConfigured={ai.configured}
                  onSource={readPaper}
                  onUpload={() => uploader.current?.click()}
                  onMatrix={(paperIds, labels) => {
                    setGraphScope({ projectId: project.id, paperIds, labels });
                    setExtractSelection({
                      projectId: project.id,
                      ids: paperIds,
                    });
                    setQuery('');
                    setView('matrix');
                  }}
                />
              )}
              {view === 'matrix' && (
                <>
                  {matrixScope && (
                    <div className="graph-matrix-scope">
                      <div>
                        <strong>
                          来自图谱：{matrixScope.labels.join(' / ')}
                        </strong>
                        <p>
                          对照对应的 {scopePapers.length} /{' '}
                          {state!.papers.length}{' '}
                          篇文献。图谱候选不会自动填入已核对单元格。
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setGraphScope(null);
                          setExtractSelection(null);
                        }}
                      >
                        显示全部课题文献
                      </Button>
                    </div>
                  )}
                  <div className="stats-row">
                    <div className="stat">
                      <span>
                        <FileText size={17} />
                        课题文献
                      </span>
                      <strong>
                        {state!.papers.length}
                        <small>篇</small>
                      </strong>
                    </div>
                    <div className="stat">
                      <span>
                        <Quote size={17} />
                        已定位依据
                      </span>
                      <strong>
                        {evidence}
                        <small>项</small>
                      </strong>
                    </div>
                    <div className="stat">
                      <span>
                        <CheckCheck size={17} />
                        已人工核对
                      </span>
                      <strong>
                        {confirmed}
                        <small>项</small>
                      </strong>
                    </div>
                    <div className="stat stat-accent">
                      <span>
                        <RefreshCw size={17} />
                        待处理信息
                      </span>
                      <strong>
                        {pending}
                        <small>
                          项{candidates > 0 && ` · ${candidates} 个新候选`}
                        </small>
                      </strong>
                    </div>
                  </div>
                  <div className="matrix-panel">
                    <div className="toolbar">
                      <div className="searchbox">
                        <Search size={16} />
                        <Input
                          aria-label="搜索文献与字段值"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder="搜索文献或字段值…"
                        />
                      </div>
                      <div className="row">
                        <Button
                          variant="outline"
                          disabled={!!busy}
                          onClick={() => setCandidateReviewOpen(true)}
                        >
                          候选审核（
                          {
                            state!.cells.filter(
                              (c) =>
                                c.candidate &&
                                filteredMatrixPapers.some(
                                  (p) => p.id === c.paperId,
                                ),
                            ).length
                          }
                          ）
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={!!busy}
                          onClick={() => editField()}
                        >
                          <Plus />
                          添加字段
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setRuleField(state!.fields[0]?.id ?? '');
                            setInstruction('');
                            setRuleModal(true);
                          }}
                        >
                          <SlidersHorizontal />
                          提取规则
                          {state!.rules.length > 0 && (
                            <span className="button-count">
                              {state!.rules.length}
                            </span>
                          )}
                        </Button>
                        <Button
                          disabled={
                            !!busy ||
                            !ai.configured ||
                            !state!.papers.length ||
                            !selectedForExtraction.length ||
                            activeJobs.some((j) => j.status !== 'failed')
                          }
                          onClick={() => extract()}
                        >
                          <Sparkles />
                          提取文献信息（{selectedForExtraction.length} 篇）
                        </Button>
                      </div>
                    </div>
                    <details className="extraction-scope">
                      <summary>
                        提取范围：已选择 {selectedForExtraction.length} /{' '}
                        {scopePapers.length} 篇（
                        {matrixScope ? '图谱对应文献' : '整个课题'}
                        ；下方选择独立于文字搜索）
                      </summary>
                      <div className="row">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!!busy}
                          onClick={() => setExtractSelection(null)}
                        >
                          选择当前范围全部
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!!busy}
                          onClick={() =>
                            setExtractSelection({
                              projectId: project.id,
                              ids: [],
                            })
                          }
                        >
                          清空选择
                        </Button>
                      </div>
                      {scopePapers.map((p) => (
                        <label key={p.id} className="paper-check">
                          <Checkbox
                            disabled={!!busy}
                            checked={selectedForExtraction.includes(p.id)}
                            onCheckedChange={(checked) =>
                              setExtractSelection({
                                projectId: project.id,
                                ids: checked
                                  ? [...selectedForExtraction, p.id]
                                  : selectedForExtraction.filter(
                                      (id) => id !== p.id,
                                    ),
                              })
                            }
                          />
                          {p.title}
                        </label>
                      ))}
                    </details>
                    {!ai.configured && (
                      <div className="model-hint">
                        <Sparkles size={15} />
                        <span>
                          连接模型后可自动提取。当前可以编辑表格、核对来源并保存记录。
                        </span>
                        <button onClick={() => setSettings(true)}>
                          连接说明
                          <ArrowUpRight size={12} />
                        </button>
                      </div>
                    )}
                    {activeJobs.length > 0 && (
                      <div className="job-banner">
                        <div>
                          <strong>{activeJobs.length} 个任务等待处理</strong>
                          <p>
                            任务在后台执行。刷新或关闭页面后，进度仍会保存。
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={!!busy}
                          onClick={() =>
                            run('继续提取…', () =>
                              processJobs(activeJobs.map((j) => j.id)),
                            )
                          }
                        >
                          继续处理
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setActivity(true)}
                        >
                          查看详情
                        </Button>
                      </div>
                    )}
                    {jobs.length > 0 && (
                      <details
                        className="extraction-scope"
                        open={activeJobs.some((j) => j.status === 'failed')}
                      >
                        <summary>
                          逐篇提取记录 ·{' '}
                          {
                            jobs.filter((j) =>
                              ['succeeded', 'failed', 'cancelled'].includes(
                                j.status,
                              ),
                            ).length
                          }{' '}
                          / {jobs.length} 已结束 · 成功{' '}
                          {jobs.filter((j) => j.status === 'succeeded').length}{' '}
                          · 失败{' '}
                          {jobs.filter((j) => j.status === 'failed').length}
                        </summary>
                        {jobs.map((j) => (
                          <div className="job-row" key={j.id}>
                            <span>
                              {
                                state!.papers.find((p) => p.id === j.paperId)
                                  ?.title
                              }
                              <small className="error-text">{j.error}</small>
                            </span>
                            <Badge kind={j.status}>
                              {statusNames[j.status]}
                            </Badge>
                            {['failed', 'queued'].includes(j.status) && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!!busy}
                                onClick={() =>
                                  run('处理文献…', () => processJobs([j.id]))
                                }
                              >
                                处理此篇
                              </Button>
                            )}
                          </div>
                        ))}
                      </details>
                    )}
                    <Matrix
                      project={project}
                      query={query}
                      paperIds={matrixScope?.paperIds}
                      onCell={(c: Cell) => setCellId(c.id)}
                      onPaper={(id) => readPaper(id)}
                      onField={editField}
                    />
                    <div className="table-footer">
                      <span>
                        筛选结果 {filteredMatrixPapers.length}/
                        {scopePapers.length} 篇文献 · {state!.fields.length}{' '}
                        个比较维度
                      </span>
                      <span>点击单元格查看证据和修改历史</span>
                    </div>
                  </div>
                  <div className="matrix-bottom">
                    <div>
                      <Link2 size={18} />
                      <span>
                        来源定位验证摘录位置；内容是否支持结论，仍需结合上下文核对。
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!!busy}
                      onClick={() => create(true)}
                    >
                      添加演示课题
                      <ArrowUpRight size={14} />
                    </Button>
                  </div>
                </>
              )}
              {view === 'reader' && (
                <Reader
                  onProject={updateCurrent}
                  key={`${project.id}:${paperId}:${focusBlock}:${focusVersion}:${project.state.papers.find((p) => p.id === paperId)?.parseVersionId ?? ''}`}
                  project={project}
                  selectedId={paperId}
                  focusBlock={focusBlock}
                  focusVersion={focusVersion}
                  select={(id) => {
                    setPaperId(id);
                    setFocusBlock('');
                  }}
                  onSource={readPaper}
                  editContext={() => newProject(true)}
                  mutate={mutate}
                  busy={!!busy}
                  aiConfigured={ai.configured}
                />
              )}
              {view === 'experiments' && (
                <Experiments
                  onProject={updateCurrent}
                  key={project.id}
                  project={project}
                  mutate={mutate}
                  busy={!!busy}
                />
              )}
              {view === 'revisions' && (
                <Revisions
                  onProject={setCurrent}
                  key={project.id}
                  project={project}
                  mutate={mutate}
                  busy={!!busy}
                  aiConfigured={ai.configured}
                  onAnalyze={() =>
                    run('正在核对修改意见…', async () => {
                      const p = current.current!;
                      setCurrent(
                        await request<Project>(`/api/projects/${p.id}/ai`, {
                          method: 'POST',
                          body: JSON.stringify({
                            task: 'review',
                            revision: p.revision,
                          }),
                        }),
                      );
                      await loadList();
                    })
                  }
                />
              )}
            </>
          )}
          <input
            ref={uploader}
            type="file"
            accept=".pdf,.txt"
            multiple
            className="hidden"
            aria-label="上传文献"
            onChange={(e) => uploadFiles(e.target.files)}
          />
        </main>
      </SidebarInset>
      {candidateReviewOpen && project && (
        <CandidateReview
          key={project.id}
          project={project}
          paperIds={filteredMatrixPapers.map((p) => p.id)}
          onClose={() => setCandidateReviewOpen(false)}
          onCell={setCellId}
          mutate={mutate}
          busy={!!busy}
        />
      )}
      {project && (
        <EvidenceSheet
          key={`${cellId ?? ''}:${project.state.cells.find((c) => c.id === cellId)?.value ?? ''}:${project.state.cells.find((c) => c.id === cellId)?.quote ?? ''}`}
          project={project}
          cellId={cellId}
          onClose={() => setCellId(null)}
          mutate={mutate}
          busy={!!busy}
          onRead={readPaper}
          onRule={(id, text) => {
            setRuleField(id);
            setInstruction(text);
            setRuleModal(true);
          }}
        />
      )}
      <Modal
        open={projectModal}
        onClose={() => setProjectModal(false)}
        title={editProject ? '编辑研究课题' : '建立研究课题'}
        description="论文、比较表、实验与修改记录都保存在同一个课题中。"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (editProject) {
              if (
                await mutate({
                  action: 'project.edit',
                  title,
                  question,
                  profile,
                })
              )
                setProjectModal(false);
            } else await create();
          }}
        >
          <Label title="课题名称">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
              required
              placeholder="例如：低算力条件下的图像识别"
            />
          </Label>
          <Label title="研究目标与问题">
            <Textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={3000}
              rows={5}
              placeholder="你想研究什么？已有方法、设备、数据或限制是什么？"
            />
          </Label>
          <Label title="设备与数据条件">
            <Textarea
              rows={2}
              maxLength={1800}
              value={profile.equipment}
              onChange={(e) =>
                setProfile({ ...profile, equipment: e.target.value })
              }
              placeholder="例如：仅 CPU、8 GB 内存、1000 张已标注图像"
            />
          </Label>
          <Label title="目前使用的方法">
            <Textarea
              rows={2}
              maxLength={1800}
              value={profile.currentMethod}
              onChange={(e) =>
                setProfile({ ...profile, currentMethod: e.target.value })
              }
              placeholder="例如：MobileNet，当前准确率 85%"
            />
          </Label>
          <Label title="限制与判断标准">
            <Textarea
              rows={2}
              maxLength={1800}
              value={profile.constraints}
              onChange={(e) =>
                setProfile({ ...profile, constraints: e.target.value })
              }
              placeholder="例如：不能增加数据标注；推理时间小于 100 ms"
            />
          </Label>
          <div className="dialog-actions">
            <Button
              type="button"
              variant="outline"
              onClick={() => setProjectModal(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={!!busy || !title.trim()}>
              {editProject ? '保存课题' : '建立课题'}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={importLogOpen}
        onClose={() => setImportLogOpen(false)}
        title="导入与提取记录"
        description="成功的导入、失败的导入，以及被丢弃的提取候选都保留在这里，刷新页面后仍可查看原因。"
      >
        {(project?.state.rejectedCandidates ?? []).length > 0 && (
          <div className="isolated-list">
            <strong>
              被丢弃的提取候选（{(project?.state.rejectedCandidates ?? []).length} 条，不是已确认事实）
            </strong>
            <p className="import-log-meta">
              这些取值是模型给出的，但引用没有通过原文证据校验，因此没有写入表格。
              用它区分「论文未报告」与「系统提取后未通过校验」。
            </p>
            {(project?.state.rejectedCandidates ?? []).slice(0, 20).map((c) => (
              <div key={c.id} className="isolated-row">
                <div>
                  <span className="import-badge import-failed">
                    {REJECT_RULES[c.rule] ?? c.rule}
                  </span>
                  <strong>{c.label}</strong>
                  <span className="import-log-meta">
                    {c.paperTitle}
                    {c.page ? ` · 第 ${c.page} 页` : ''} ·{' '}
                    {c.at.replace('T', ' ').slice(0, 19)}
                  </span>
                </div>
                <div className="import-log-message">
                  候选值：{String(c.value).slice(0, 120)}
                </div>
                <div className="import-log-message">{c.reason}</div>
              </div>
            ))}
          </div>
        )}
        {importLog.length === 0 && (project?.state.rejectedCandidates ?? []).length === 0 ? (
          <p className="import-log-meta">当前课题还没有导入记录。</p>
        ) : (
          <div className="import-log">
            {importLog.map((entry) => (
              <div key={entry.id} className="import-log-row">
                <div className="import-log-head">
                  <span
                    className={
                      entry.status === 'ok'
                        ? 'import-badge import-ok'
                        : 'import-badge import-failed'
                    }
                  >
                    {entry.status === 'ok' ? '成功' : '失败'}
                  </span>
                  <strong>{entry.filename}</strong>
                  <span className="import-log-meta">
                    {(entry.bytes / 1_048_576).toFixed(2)} MB ·{' '}
                    {entry.stage === 'client' ? '浏览器端' : '服务端'} ·{' '}
                    {entry.at.replace('T', ' ').slice(0, 19)}
                  </span>
                </div>
                <div className="import-log-meta">
                  原因：{REASON_LABELS[entry.reason] ?? entry.reason}
                  {entry.pages ? ` · ${entry.pages} 页` : ''}
                  {entry.chars ? ` · ${entry.chars} 字符` : ''}
                </div>
                <div className="import-log-message">{entry.message}</div>
              </div>
            ))}
          </div>
        )}
      </Modal>
      <Modal
        open={fieldModal}
        onClose={() => setFieldModal(false)}
        title={fieldId ? '编辑比较字段' : '添加比较字段'}
        description="明确提取口径。修改字段定义后，现有数据会标为待复查。"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await mutate({
                action: 'field.save',
                id: fieldId || undefined,
                name: fieldName,
                definition,
              })
            )
              setFieldModal(false);
          }}
        >
          <Label title="字段名称">
            <Input
              value={fieldName}
              onChange={(e) => setFieldName(e.target.value)}
              maxLength={60}
              required
            />
          </Label>
          <Label title="提取定义">
            <Textarea
              value={definition}
              onChange={(e) => setDefinition(e.target.value)}
              rows={5}
              maxLength={1800}
              placeholder="说明应提取哪些内容、单位、范围，以及没有报告时如何处理。"
            />
          </Label>
          <Button type="submit" disabled={!!busy || !fieldName.trim()}>
            保存字段
          </Button>
        </form>
      </Modal>
      <Modal
        open={ruleModal}
        onClose={() => setRuleModal(false)}
        title="项目提取规则"
        description="规则只作用于当前课题的指定字段。同一字段以最近确认的一版为准。"
        wide
      >
        <Label title="作用字段">
          <Picker
            value={ruleField}
            onChange={setRuleField}
            label="选择字段"
            options={
              state?.fields.map((f) => ({ value: f.id, label: f.name })) ?? []
            }
          />
        </Label>
        <Label title="完整提取规则">
          <Textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            rows={4}
            maxLength={1500}
            placeholder="例如：只提取独立测试集样本量，不能把预训练、训练或验证数据算在内。"
          />
        </Label>
        <div className="rule-impact">
          <strong>影响范围</strong>
          <p>
            当前字段的{' '}
            {state?.cells.filter((c) => c.fieldId === ruleField).length ?? 0}{' '}
            个单元格将标为待复查。原值保留，新结果需接受后替换。
          </p>
        </div>
        <Button
          disabled={!!busy || !ruleField || instruction.trim().length < 3}
          onClick={async () => {
            if (
              await mutate({
                action: 'rule.add',
                fieldId: ruleField,
                instruction,
              })
            )
              setInstruction('');
          }}
        >
          确认规则并标记复查
        </Button>
        <div className="rule-history">
          {state?.rules
            .filter((r) => r.fieldId === ruleField)
            .toReversed()
            .map((r, i) => (
              <div key={r.id}>
                <div className="row">
                  <Badge kind={i === 0 ? 'confirmed' : 'pending'}>
                    {i === 0 ? '当前规则' : '历史规则'} · V{r.version}
                  </Badge>
                  <small>
                    {new Date(r.createdAt).toLocaleDateString('zh-CN')}
                  </small>
                </div>
                <p>{r.instruction}</p>
              </div>
            ))}
        </div>
        <Button
          variant="outline"
          disabled={
            !!busy ||
            !ai.configured ||
            !state?.papers.length ||
            activeJobs.some(
              (j) => j.status === 'queued' || j.status === 'running',
            )
          }
          onClick={async () => {
            setRuleModal(false);
            await extract([ruleField]);
          }}
        >
          <RefreshCw />
          按当前规则重新提取这一列
        </Button>
      </Modal>
      <Modal
        open={settings}
        onClose={() => setSettings(false)}
        title="模型与用量"
        description="模型密钥由服务端保管，不会发送到浏览器。"
        wide
      >
        <div className="connection-card">
          <span
            className={`connection-dot ${ai.configured ? 'connected' : ''}`}
          />
          <div>
            <strong>{ai.configured ? '模型配置已就绪' : '尚未配置模型'}</strong>
            <p>
              {ai.configured
                ? ai.model
                : '自动提取、问答与改稿分析需要连接云端模型。'}
            </p>
          </div>
        </div>
        <div className="usage-grid">
          <div>
            <strong>{usage.total}</strong>
            <span>今日调用次数</span>
          </div>
          <div>
            <strong>{usage.inputTokens.toLocaleString()}</strong>
            <span>输入 Token</span>
          </div>
          <div>
            <strong>{usage.outputTokens.toLocaleString()}</strong>
            <span>输出 Token</span>
          </div>
        </div>
        {guest && <p className="help-text">免登录访客空间：资料保存在当前浏览器会话中，清除 Cookie 将失去访问权限。全站共享每日 AI 额度。云端队列执行时请保持页面打开；刷新后可恢复未完成任务。</p>}
        <p className="help-text">
          每日调用上限：{ai.dailyLimit} 次。Token
          用量不是费用金额，实际计费以模型服务商账单为准。
        </p>
        {!ai.configured && (
          <div className="configuration-note">
            <h3>接入配置</h3>
            <p>由项目维护者在服务端设置以下三项，重启或重新部署后生效：</p>
            <pre>
              AI_BASE_URL=https://api.deepseek.com
              <br />
              AI_MODEL=deepseek-flash
              <br />
              AI_API_KEY=你的服务端密钥
            </pre>
            <p>本地开发详见项目 README；不要把密钥粘贴进论文或普通聊天框。</p>
          </div>
        )}
        <div className="scope-note">
          <h3>当前支持范围</h3>
          <p>
            每课题 {LIMITS.papersPerProject} 篇文献、{LIMITS.fieldsPerProject}{' '}
            个字段；每篇最多 {FILE_MB} MB、{LIMITS.maxPages} 页、
            {LIMITS.maxTotalChars.toLocaleString('en-US')} 解析字符。
            超长文献按段保存、按段处理，单次模型任务只使用其中的一部分。
            支持文字 PDF 和 TXT。复杂排版需要人工核对，扫描件需先进行 OCR。
          </p>
        </div>
        <Button
          variant="outline"
          disabled={!!busy}
          onClick={() =>
            run('检查模型配置…', async () => {
              await loadList();
              setNotice({
                text: '配置状态已刷新。实际连通性将在调用时检查。',
                error: false,
              });
            })
          }
        >
          <RefreshCw />
          刷新配置状态
        </Button>
      </Modal>
      <Modal
        open={activity}
        onClose={() => setActivity(false)}
        title="活动与任务"
        description="核对、提取与资料变更都会留下记录。"
        wide
      >
        <div className="activity-modal">
          {jobs.length > 0 && (
            <>
              <h3>文献提取任务</h3>
              {jobs.map((j) => (
                <div className="job-item" key={j.id}>
                  <div>
                    <Badge kind={j.status}>{statusNames[j.status]}</Badge>
                    <p>
                      {state?.papers.find((p) => p.id === j.paperId)?.title ??
                        '文献'}
                    </p>
                    {j.error && <small className="error-text">{j.error}</small>}
                  </div>
                  {['queued', 'failed', 'running'].includes(j.status) && (
                    <div className="row">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!!busy}
                        onClick={() =>
                          run('继续任务…', () => processJobs([j.id]))
                        }
                      >
                        继续
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!!busy}
                        onClick={() =>
                          run('取消任务…', async () => {
                            await request(`/api/jobs/${j.id}`, {
                              method: 'POST',
                              body: JSON.stringify({ action: 'cancel' }),
                            });
                            await loadProject(project!.id);
                          })
                        }
                      >
                        取消
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
          <h3>课题活动</h3>
          {!state?.activity.length ? (
            <p className="secondary">开始整理资料后，活动会记录在这里。</p>
          ) : (
            state.activity.map((a) => (
              <div className="activity-item" key={a.id}>
                <span />
                <div>
                  <p>{a.text}</p>
                  <small>{new Date(a.at).toLocaleString('zh-CN')}</small>
                </div>
              </div>
            ))
          )}
        </div>
        {project && (
          <Button
            variant="outline"
            onClick={() =>
              downloadFile(
                `${project.title}-记录备份.json`,
                JSON.stringify(project, null, 2),
                'application/json',
              )
            }
          >
            <Download />
            导出课题记录（不含原文件）
          </Button>
        )}
      </Modal>
    </SidebarProvider>
  );
}
