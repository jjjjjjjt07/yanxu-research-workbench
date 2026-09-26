import { LIMITS } from './limits.ts';
import { resolveEvidence } from './evidence.ts';

export type Field = {
  id: string;
  name: string;
  definition: string;
  version: number;
};
export type Block = {
  ocr?: { model: string; previewId: string };
  id: string;
  page: number;
  text: string;
  rect?: number[];
  width?: number;
  height?: number;
};
export type Paper = {
  parseVersionId?: string;
  parseVersions?: import('./parse-versions').ParseVersion[];
  parsing?: import('./pdf-layout').ParseQuality;
  metadata?: import('./scholar').ScholarlyWork;
  coverage?: 'fulltext' | 'abstract' | 'metadata';
  id: string;
  title: string;
  filename: string;
  pages: number;
  hash: string;
  kind: 'pdf' | 'text';
  sample: boolean;
  blockCount: number;
  /** 解析块分段存储时的段数；缺省表示单对象存储。 */
  blockSegments?: number;
  /** 解析全文的字符数（去空白前的原始长度，便于核对是否被截断）。 */
  chars?: number;
  importedAt: string;
};
/**
 * 一次导入尝试（含失败）。写入课题状态，刷新后仍可查看为什么某篇没进来。
 */
export type ImportAttempt = {
  id: string;
  at: string;
  filename: string;
  bytes: number;
  status: 'ok' | 'failed';
  stage: 'client' | 'server';
  reason: string;
  message: string;
  pages?: number;
  chars?: number;
  paperId?: string;
};
export type CellValue = {
  evidenceRef?: {
    id: string;
    graphRevision: number;
    documentHash: string;
    parseHash: string;
  };
  /**
   * 引用位置被系统校正过（模型说的位置与实际位置不同）。
   * 跨页校正时置 needsCitationReview，表示该取值**未被自动确认**。
   */
  citationMoved?: {
    fromBlockId: string;
    fromPage: number | null;
    toBlockId: string;
    toPage: number;
  };
  needsCitationReview?: boolean;
  /**
   * 摘录只在旧版解析（v2）的双栏页里能连贯命中，在原 PDF 上可能读不出一句完整的话。
   * 这类引用必须由界面明确标为「原文摘录待核对」。
   */
  excerptNeedsReview?: boolean;
  value: string;
  blockId: string;
  quote: string;
  page: number | null;
  sourceValid: boolean;
  origin: 'ai' | 'manual' | 'sample';
  note: string;
  fieldVersion: number;
  ruleVersion: number;
};
export type Cell = CellValue & {
  id: string;
  paperId: string;
  fieldId: string;
  status: 'pending' | 'confirmed' | 'unknown' | 'stale';
  history: { at: string; value: CellValue; status: string; reason: string }[];
  candidate?: CellValue;
};
export type Rule = {
  id: string;
  fieldId: string;
  instruction: string;
  version: number;
  createdAt: string;
};
export type DataRow = {
  runId?: string;
  method: string;
  dataset: string;
  metric: string;
  value: number;
};
export type Experiment = {
  artifacts?: import('./experiment-artifacts').ExperimentArtifact[];
  reproductions?: import('./experiment-artifacts').IndependentReproduction[];
  comparisons?: import('./experiment-comparison').ExperimentComparison[];
  intervals?: import('./experiment-interval').MeanInterval[];
  id: string;
  name: string;
  direction: 'higher' | 'lower';
  versions: {
    id: string;
    at: string;
    filename: string;
    rows: DataRow[];
    statistics?: import('./experiment-statistics').ExperimentStatistics;
    csvSource?: import('./experiment-csv').CsvSource;
    reproducibility?: import('./experiment-reproducibility').ReproducibilityRecord;
    scope?: import('./experiment-scope').ExperimentScopeRecord;
  }[];
};
export type Claim = {
  id: string;
  text: string;
  experimentId: string;
  method: string;
  otherMethod: string;
  dataset: string;
  metric: string;
  relation: 'higher' | 'lower' | 'equal' | 'number';
  expected: number | null;
  checkedVersion: string;
  result: 'pass' | 'fail' | 'missing';
  detail: string;
  needsReview: boolean;
};
export type ReviewItem = {
  id: string;
  instruction: string;
  evidence: string;
  explanation: string;
  status: 'open' | 'partial' | 'review' | 'done';
  confirmation: string;
};
export type Review = {
  observationCitations?: import('./observation-citations').ObservationCitation[];
  citations?: import('./manuscript-citations').ManuscriptCitation[];
  versions?: import('./manuscript').ManuscriptVersion[];
  oldText: string;
  newText: string;
  feedback: string;
  items: ReviewItem[];
  analyzedHash: string;
  history: {
    at: string;
    oldText: string;
    newText: string;
    feedback: string;
    items: ReviewItem[];
  }[];
};
export type ProjectState = {
  observations?: import('./observations').Observation[];
  answerEvidenceLinks?: import('./answer-evidence').AnswerEvidenceLink[];
  candidateReviews?: import('./candidate-review').CandidateDecision[];
  bibliographyImports?: {
    id: string;
    filename: string;
    format: string;
    hash: string;
    at: string;
    paperIds: string[];
    entries: number[];
  }[];
  contextVersion?: number;
  searches?: {
    id: string;
    query: string;
    at: string;
    results: import('./scholar').ScholarlyWork[];
  }[];
  profile?: { equipment: string; currentMethod: string; constraints: string };
  readingFeedback?: {
    id: string;
    paperIds: string[];
    text: string;
    status: 'tried' | 'unsuitable' | 'verify';
    reason: string;
    at: string;
  }[];
  papers: Paper[];
  /** 导入记录（成功与失败）。保留最近若干条，刷新后仍可查看失败原因。 */
  importLog?: ImportAttempt[];
  /**
   * 提取/构图阶段被丢弃的候选（含原因）。与导入记录同理持久化，
   * 让界面能区分「论文未报告」与「系统提取后未通过证据校验」。
   * 这些条目**不是已确认事实**，只是候选。
   */
  rejectedCandidates?: RejectedCandidate[];
  fields: Field[];
  cells: Cell[];
  rules: Rule[];
  notes: import('./source-reference').ReadingNote[];
  experiments: Experiment[];
  claims: Claim[];
  review: Review;
  activity: { id: string; at: string; text: string }[];
};
export type Project = {
  id: string;
  title: string;
  question: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  state: ProjectState;
};
export type Job = {
  id: string;
  projectId: string;
  status: string;
  paperId: string;
  fieldIds: string[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
};
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export function emptyState(): ProjectState {
  return {
    profile: { equipment: '', currentMethod: '', constraints: '' },
    readingFeedback: [],
    papers: [],
    fields: [
      {
        id: uid(),
        name: '研究方法',
        definition: '论文提出或主要评估的方法名称与核心思路。',
        version: 1,
      },
      {
        id: uid(),
        name: '数据集',
        definition: '实验使用的数据集名称。多个数据集分别列出。',
        version: 1,
      },
      {
        id: uid(),
        name: '测试样本量',
        definition:
          '独立测试集样本量，不包含训练集与验证集。没有明确报告时保留未知。',
        version: 1,
      },
      {
        id: uid(),
        name: '评价指标',
        definition: '报告指标名称、数值及对应数据集，保留百分比等单位。',
        version: 1,
      },
      {
        id: uid(),
        name: '实验条件',
        definition:
          '原文明确报告的设备与实验条件，不根据设备型号推断内存或显存需求。',
        version: 1,
      },
    ],
    cells: [],
    rules: [],
    notes: [],
    experiments: [],
    claims: [],
    review: {
      oldText: '',
      newText: '',
      feedback: '',
      items: [],
      analyzedHash: '',
      history: [],
    },
    activity: [],
  };
}
export function logActivity(state: ProjectState, text: string) {
  state.activity.unshift({ id: uid(), at: now(), text });
}
/** 记录一次导入尝试（成功或失败），保留最近若干条。 */
export function recordImportAttempt(
  state: ProjectState,
  entry: Omit<ImportAttempt, 'id' | 'at'> & { at?: string },
) {
  const { at, ...rest } = entry;
  const log = (state.importLog ??= []);
  log.unshift({ id: uid(), at: at ?? now(), ...rest });
  if (log.length > LIMITS.importLogEntries) log.length = LIMITS.importLogEntries;
}
/**
 * 提取/构图阶段被丢弃的候选。
 * 记录的字段足以回答「哪个候选、哪篇论文、哪一页、因为哪条规则、可读原因是什么」。
 */
export type RejectedCandidate = {
  id: string;
  at: string;
  kind: 'field' | 'relation';
  paperId: string;
  paperTitle: string;
  page: number | null;
  /** 字段名，或“A —使用→ B”这类关系描述 */
  label: string;
  /** 候选值（取值或关系条件） */
  value: string;
  quote: string;
  rule: string;
  reason: string;
  /** 规则码的中文说明由界面渲染；这里保留原始规则码以便筛选 */
  stage: 'extraction' | 'graph';
  /**
   * 处置方式：
   * - rejected：证据确实不成立，直接丢弃；
   * - pending-review：证据真实但位置/依据存疑（例如跨页才找到摘录），
   *   保留下来等人工核对，**没有填入表格**。
   */
  disposition: 'rejected' | 'pending-review';
  /** pending-review 时，系统实际定位到的位置。 */
  located?: { blockId: string; page: number | null; quote: string };
};

export const REJECT_RULES: Record<string, string> = {
  'no-block': '模型未给出引用块编号',
  'not-in-cited-block': '摘录在所引块内找不到连续原文',
  'not-found-anywhere': '摘录在全篇任何块内都找不到',
  'empty-quote': '摘录为空或过短',
  'too-short': '摘录过短，不足以作为证据',
  'endpoint-missing': '关系端点实体未通过原文提及检查',
  'self-loop': '关系两端为同一实体',
  'evidence-not-found': '关系摘录在所引块内找不到连续原文',
  'citation-moved-cross-page': '摘录只在其它页找到，取值未填入',
  'excerpt-missing': '引用的原文片段编号不存在',
  'mention-not-locatable': '实体提及的片段在原文里定位不到',
  'surface-not-in-excerpt': '片段正文里没有该名称的逐字写法',
};

export function rejectRuleLabel(rule: string) {
  return REJECT_RULES[rule] ?? rule;
}

export function recordRejectedCandidate(
  state: ProjectState,
  entry: Omit<RejectedCandidate, 'id' | 'at'> & { at?: string },
) {
  const { at, ...rest } = entry;
  const list = (state.rejectedCandidates ??= []);
  list.unshift({ id: uid(), at: at ?? now(), ...rest });
  if (list.length > LIMITS.rejectedCandidates) list.length = LIMITS.rejectedCandidates;
}
export function ensureCells(state: ProjectState) {
  for (const p of state.papers)
    for (const f of state.fields)
      if (!state.cells.some((c) => c.paperId === p.id && c.fieldId === f.id))
        state.cells.push({
          id: uid(),
          paperId: p.id,
          fieldId: f.id,
          value: '',
          blockId: '',
          quote: '',
          page: null,
          sourceValid: false,
          origin: 'ai',
          note: '尚未提取。',
          fieldVersion: f.version,
          ruleVersion:
            state.rules.filter((r) => r.fieldId === f.id).at(-1)?.version ?? 0,
          status: 'pending',
          history: [],
        });
}
export function cellSnapshot(c: CellValue): CellValue {
  const {
    value,
    blockId,
    quote,
    page,
    sourceValid,
    origin,
    note,
    fieldVersion,
    ruleVersion,
    evidenceRef,
  } = c;
  return {
    value,
    blockId,
    quote,
    page,
    sourceValid,
    origin,
    note,
    fieldVersion,
    ruleVersion,
    evidenceRef: evidenceRef ? { ...evidenceRef } : undefined,
  };
}
export function validateEvidence(
  blocks: Block[],
  blockId: string,
  quote: string,
) {
  return resolveEvidence(blocks, { blockId, quote }).ok;
}

/** 一次「未通过证据校验」或「需人工核对」的候选信息，供持久化与界面展示。 */
export type RejectionDraft = {
  value: string;
  blockId: string;
  quote: string;
  page: number | null;
  rule: string;
  reason: string;
  /** true 表示不是丢弃，而是保留下来等人工核对（例如跨页找到摘录）。 */
  pendingReview?: boolean;
  /** 系统实际定位到的位置（可能与模型所引不同）。 */
  located?: { blockId: string; page: number | null; quote: string };
};

export function checkedValue(
  raw: Partial<CellValue>,
  blocks: Block[],
  field: Field,
  ruleVersion: number,
  origin: CellValue['origin'] = 'ai',
  onReject?: (draft: RejectionDraft) => void,
  layout?: { engine?: string; twoColumnPages?: number[] },
): CellValue {
  const value = String(raw.value ?? '')
      .trim()
      .slice(0, 1600),
    blockId = String(raw.blockId ?? ''),
    quote = String(raw.quote ?? '').slice(0, 2000);
  // 统一校验：本块逐字 → 本块有限归一化 → 同页/全篇重定位 → 仍失败才拒绝。
  const found = resolveEvidence(blocks, { blockId, quote });
  const citedPage = blocks.find((b) => b.id === blockId)?.page ?? null;
  const moved =
    found.ok && found.relocated
      ? {
          fromBlockId: blockId,
          fromPage: citedPage,
          toBlockId: found.blockId,
          toPage: found.page,
        }
      : undefined;
  // 跨页才命中说明模型说的位置和摘录实际位置不一致：
  // 摘录本身是真的，但**不能**用它把取值填进已确认字段。
  const crossPage = !!moved && moved.fromPage !== moved.toPage;
  if (!found.ok && value)
    onReject?.({
      value,
      blockId,
      quote,
      page: citedPage,
      rule: found.rule,
      reason: found.reason,
    });
  else if (crossPage && value)
    onReject?.({
      value,
      blockId,
      quote,
      page: found.ok ? found.page : null,
      rule: 'citation-moved-cross-page',
      reason: `模型把摘录标在第 ${moved!.fromPage ?? '?'} 页，实际在第 ${found.ok ? found.page : '?'} 页找到。取值保留为待人工核对候选，未填入表格。`,
      pendingReview: true,
      located: found.ok
        ? { blockId: found.blockId, page: found.page, quote: found.text }
        : undefined,
    });
  const applied = found.ok && !crossPage;
  // 旧版解析（v2）在双栏页上可能把两栏文字交错，摘录能命中产品块、却读不出一句完整原文。
  const legacyColumns =
    !!layout &&
    layout.engine !== 'pdfjs-layout-v3' &&
    !!found.ok &&
    !!layout.twoColumnPages?.includes(found.page);
  const relocatedNote = crossPage
    ? `模型引用的位置（${moved!.fromPage ? `第 ${moved!.fromPage} 页` : '块编号无效'}）与摘录实际所在位置（第 ${moved!.toPage} 页）不一致。该取值**未填入**，已保留为待人工核对候选。`
    : moved
      ? `模型引用的块编号有误，已按原文校正到第 ${moved.toPage} 页的另一个文本块。`
      : '';
  return {
    value: applied ? value : '',
    // 未填入时仍保留实际定位位置与摘录，便于人工核对；sourceValid=false 保证下游不会当成已确认事实。
    blockId: found.ok ? found.blockId : '',
    quote: found.ok ? found.text : '',
    page: found.ok ? found.page : null,
    sourceValid: applied,
    origin,
    ...(moved && !applied ? { citationMoved: moved, needsCitationReview: true } : {}),
    ...(legacyColumns ? { excerptNeedsReview: true } : {}),
    note: found.ok
      ? [
          String(raw.note ?? '').trim(),
          relocatedNote,
          legacyColumns
            ? `解析版本较旧：该文献由旧版解析（双栏页），系统在这里可能读不出连贯原文，建议对照原 PDF 核对（重新导入即可升级到新版解析）。`
            : '',
        ]
          .filter(Boolean)
          .join('\n')
          .slice(0, 1200)
      : value
        ? `候选值未通过证据校验，未填入：${found.reason}`
        : String(raw.note || '在已提供材料中未找到可靠依据。'),
    fieldVersion: field.version,
    ruleVersion,
  };
}
export function applyExtraction(
  state: ProjectState,
  paperId: string,
  fieldId: string,
  value: CellValue,
) {
  const old = state.cells.find(
    (c) => c.paperId === paperId && c.fieldId === fieldId,
  );
  if (old) {
    if (
      old.status === 'confirmed' ||
      old.status === 'stale' ||
      old.origin === 'manual'
    )
      old.candidate = value;
    else {
      old.history.push({
        at: now(),
        value: cellSnapshot(old),
        status: old.status,
        reason: '重新提取',
      });
      Object.assign(old, value, {
        evidenceRef: value.evidenceRef,
        status: value.value ? 'pending' : 'unknown',
      });
    }
  } else
    state.cells.push({
      ...value,
      id: uid(),
      paperId,
      fieldId,
      status: value.value ? 'pending' : 'unknown',
      history: [],
    });
}
export function editCell(
  state: ProjectState,
  cellId: string,
  patch: { value: string; reason: string; blockId?: string; quote?: string },
  blocks: Block[],
) {
  const c = state.cells.find((c) => c.id === cellId);
  if (!c) throw new Error('单元格不存在。');
  c.history.push({
    at: now(),
    value: cellSnapshot(c),
    status: c.status,
    reason: patch.reason || '人工核对',
  });
  c.value = patch.value.trim();
  if (
    (patch.blockId !== undefined && patch.blockId !== c.blockId) ||
    (patch.quote !== undefined && patch.quote !== c.quote)
  )
    delete c.evidenceRef;
  c.origin = 'manual';
  c.blockId = patch.blockId ?? c.blockId;
  c.quote = patch.quote ?? c.quote;
  c.sourceValid = validateEvidence(blocks, c.blockId, c.quote);
  c.page = c.sourceValid ? blocks.find((b) => b.id === c.blockId)!.page : null;
  c.note = patch.reason;
  c.status = 'confirmed';
  c.fieldVersion =
    state.fields.find((field) => field.id === c.fieldId)?.version ??
    c.fieldVersion;
  c.ruleVersion =
    state.rules.filter((rule) => rule.fieldId === c.fieldId).at(-1)?.version ??
    0;
  delete c.candidate;
}
export function addRule(
  state: ProjectState,
  fieldId: string,
  instruction: string,
) {
  if (!state.fields.some((f) => f.id === fieldId))
    throw new Error('字段不存在。');
  const version =
    (state.rules.filter((r) => r.fieldId === fieldId).at(-1)?.version ?? 0) + 1;
  state.rules.push({
    id: uid(),
    fieldId,
    instruction,
    version,
    createdAt: now(),
  });
  state.cells
    .filter((c) => c.fieldId === fieldId)
    .forEach((c) => {
      c.status = 'stale';
      delete c.candidate;
    });
  logActivity(state, '确认提取规则，相关单元格已标为待复查。');
}
export function evaluateClaim(
  claim: Claim,
  experiment: Experiment,
): Pick<Claim, 'result' | 'detail'> {
  const rows = experiment.versions.at(-1)?.rows ?? [];
  const matches = (method: string) =>
    rows.filter(
      (r) =>
        r.method === method &&
        r.dataset === claim.dataset &&
        r.metric === claim.metric,
    );
  const a = matches(claim.method),
    b = matches(claim.otherMethod);
  if (a.length > 1 || (claim.relation !== 'number' && b.length > 1))
    return {
      result: 'missing',
      detail:
        '对应方法包含多次运行；此描述尚未指定运行或统计量，不能自动采用首行或均值。',
    };
  if (a.length !== 1 || (claim.relation !== 'number' && b.length !== 1))
    return { result: 'missing', detail: '对应数据缺失或重复，无法自动判断。' };
  const av = a[0].value,
    bv = claim.relation === 'number' ? claim.expected : b[0].value;
  if (bv === null)
    return { result: 'missing', detail: '尚未指定要核对的数值。' };
  const pass =
    claim.relation === 'higher'
      ? av > bv
      : claim.relation === 'lower'
        ? av < bv
        : Math.abs(av - bv) <= 1e-9 * Math.max(1, Math.abs(av), Math.abs(bv));
  return {
    result: pass ? 'pass' : 'fail',
    detail: `${claim.method}：${av}；${claim.relation === 'number' ? '文字中的数值' : claim.otherMethod}：${bv}（${claim.dataset} / ${claim.metric}）`,
  };
}
export function refreshClaims(state: ProjectState, experimentId: string) {
  const exp = state.experiments.find((e) => e.id === experimentId);
  if (!exp) return;
  state.claims
    .filter((c) => c.experimentId === experimentId)
    .forEach((c) => {
      Object.assign(c, evaluateClaim(c, exp));
      c.needsReview = c.checkedVersion !== exp.versions.at(-1)!.id;
    });
}
export function csvEscape(value: unknown) {
  let s = value == null ? ''
    : typeof value === 'string' ? value
    : typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' ? String(value)
    : JSON.stringify(value) ?? '';
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
export function exportCSV(p: Project) {
  const rows: unknown[][] = [
    [
      '论文',
      '文件',
      '字段',
      '字段定义',
      '值',
      '状态',
      '原文页码',
      '原文摘录',
      '依据位置有效',
      '来源类型',
      '备注',
    ],
  ];
  for (const paper of p.state.papers)
    for (const f of p.state.fields) {
      const c = p.state.cells.find(
        (c) => c.paperId === paper.id && c.fieldId === f.id,
      );
      rows.push([
        paper.title,
        paper.filename,
        f.name,
        f.definition,
        c?.value ?? '',
        c?.status ?? '未提取',
        c?.page ?? '',
        c?.quote ?? '',
        c?.sourceValid ? '是' : '否',
        c?.origin ?? '',
        c?.note ?? '',
      ]);
    }
  return '\uFEFF' + rows.map((r) => r.map(csvEscape).join(',')).join('\r\n');
}
export function validateRows(rows: DataRow[]) {
  if (!rows.length || rows.length > 2000)
    throw new Error('实验数据需要 1—2000 行。');
  const keys = new Set<string>();
  const groups = new Map<string, { count: number; unnumbered: boolean }>();
  for (const r of rows) {
    if (
      !r.method?.trim() ||
      !r.dataset?.trim() ||
      !r.metric?.trim() ||
      !Number.isFinite(r.value)
    )
      throw new Error('每行必须包含方法、数据集、指标和有效数值。');
    if (
      r.runId !== undefined &&
      (typeof r.runId !== 'string' || !r.runId.trim() || r.runId.length > 80)
    )
      throw new Error('运行编号须为1—80个字符。');
    const groupKey = JSON.stringify([r.method, r.dataset, r.metric]);
    const group = groups.get(groupKey) ?? { count: 0, unnumbered: false };
    group.count++;
    group.unnumbered ||= r.runId === undefined;
    groups.set(groupKey, group);
    const key = JSON.stringify([
      r.method,
      r.dataset,
      r.metric,
      r.runId?.trim() ?? null,
    ]);
    if (keys.has(key))
      throw new Error(
        '同一方法、数据集、指标和运行编号有重复记录；重复实验请为每次运行填写不同的runId。',
      );
    keys.add(key);
  }
  if ([...groups.values()].some((g) => g.count > 1 && g.unnumbered))
    throw new Error(
      '同一组包含多次运行时，每条记录都须填写唯一的runId，不能混用未编号的汇总值。',
    );
}
