import { z } from 'zod';
import type { Block, Paper, Project } from './domain';
import { resolveEvidence, foldForMatch } from './evidence.ts';
import { reviewRelationType } from './relation-review.ts';

export const nodeNames = {
  problem: '问题',
  concept: '概念',
  hypothesis: '假设',
  formula: '公式',
  method: '方法',
  data: '数据',
  observation: '观察',
  conclusion: '结论',
};
export const relationNames = {
  uses: '使用',
  depends: '依赖',
  supports: '支持',
  contradicts: '反对',
  limits: '限制',
  compares: '对比',
  association: '待验证关联',
  // 新增：把「论文在数据集上训练/评估某方法」与「方法实际使用某组件」区分开。
  // 已存在的旧关系不会被静默改写，只会被标记为需复核（见 relation-review.ts）。
  trainedOn: '在…上训练',
  evaluatedOn: '在…上评估',
};
export const reviewNames = {
  candidate: '机器候选',
  confirmed: '人工核对',
  rejected: '已拒绝',
  stale: '待复查',
};
export type NodeType = keyof typeof nodeNames;
export type RelationType = keyof typeof relationNames;
export type ReviewStatus = keyof typeof reviewNames;
export type Entity = {
  id: string;
  name: string;
  type: NodeType;
  aliases: string[];
  domain: string;
  definition: string;
  paperIds: string[];
  mergedInto?: string;
};
export type Evidence = {
  id: string;
  paperId: string;
  documentHash: string;
  parseHash: string;
  blockId: string;
  page: number;
  quote: string;
  rect?: number[];
  runId: string;
  /**
   * **内部诊断**，不面向用户展示：该摘录命中片段里存在非句末硬换行，
   * 疑似分栏交错。实测误报很多（68 条里命中 54 条，普通折行也会触发），
   * 因此只用于排查解析质量，不用来判断证据是否可靠。
   */
  layoutRisk?: boolean;
  /** 引用位于旧版解析的双栏页：界面上标「原文摘录待核对」。 */
  excerptNeedsReview?: boolean;
  /** 引用位置被系统校正时记录模型原引的块与页码。 */
  relocatedFrom?: { blockId: string; page: number | null };
};
export type Mention = {
  id: string;
  entityId: string;
  evidenceId: string;
  surface: string;
};
export type Relation = {
  id: string;
  source: string;
  target: string;
  type: RelationType;
  condition: string;
  evidenceIds: string[];
  status: ReviewStatus;
  support: 'supported' | 'partial' | 'conflict' | 'unknown';
  reason: string;
  runId: string;
  /**
   * 关系类型与原文动作是否一致的复核结果。
   * 只做标记，不改写 type——旧关系需要在界面上被人工确认后才迁移。
   */
  typeReview?: {
    status: 'ok' | 'needs-review';
    suggested?: RelationType;
    reason: string;
    /** 落库时间；仅读取时计算的复核结果没有该字段。 */
    at?: string;
  };};
/**
 * 被隔离的候选。以前只累加到 warnings 里就丢掉了，界面上只剩一个计数；
 * 现在连同论文、页码、规则码与可读原因一起持久化，供界面区分
 * 「论文未报告」与「系统提取后未通过证据校验」。
 * 注意：被隔离的候选**不是已确认事实**，只能以「候选/未通过校验」的身份展示。
 */
export type IsolatedCandidate = {
  kind: 'relation' | 'entity';
  label: string;
  detail: string;
  rule:
    | 'endpoint-missing'
    | 'self-loop'
    | 'evidence-not-found'
    | 'excerpt-missing'
    | 'mention-not-locatable'
    | 'surface-not-in-excerpt';
  reason: string;
  paperId: string;
  paperTitle: string;
  page: number | null;
  quote: string;
  /** 落库时间；未落库的候选可以没有。 */
  at?: string;
};
export type Bridge = {  id: string;
  source: string;
  target: string;
  question: string;
  mapping: string;
  differences: string;
  risks: string;
  experiment: string;
  evidenceIds: string[];
  relationIds: string[];
  kind: 'known' | 'transfer';
  status: 'candidate' | 'explore' | 'tried' | 'unsuitable' | 'stale';
  reason: string;
  contextHash: string;
  runId: string;
};
export type GraphView = {
  id: string;
  name: string;
  focus: string;
  query: string;
  type: string;
  review: string;
  network: string;
  depth: number;
  positions: Record<string, { x: number; y: number }>;
};
export type Graph = {
  revision: number;
  entities: Entity[];
  mentions: Mention[];
  evidence: Evidence[];
  relations: Relation[];
  bridges: Bridge[];
  views: GraphView[];
  coverage: {
    paperId: string;
    runId: string;
    totalBlocks: number;
    blockIds: string[];
    missingPages: number[];
    warning: string;
    at: string;
  }[];
  /**
   * 被隔离的候选（持久化，保留最近若干条）。
   * 以前这些信息只进 warnings 字符串、随响应丢弃，界面只剩计数。
   */
  isolated: IsolatedCandidate[];
};
export const emptyGraph = (): Graph => ({
  revision: 0,
  entities: [],
  mentions: [],
  evidence: [],
  relations: [],
  bridges: [],
  views: [],
  coverage: [],
  isolated: [],
});
const short = z.string().trim().min(1).max(500);
const evidenceRef = z.object({
  blockId: short,
  quote: z.string().min(3).max(2000),
});
export const graphExtractionSchema = z.object({
  entities: z
    .array(
      z.object({
        key: short,
        name: short,
        type: z.enum([
          'problem',
          'concept',
          'hypothesis',
          'formula',
          'method',
          'data',
          'observation',
          'conclusion',
        ]),
        aliases: z.array(short).max(10).default([]),
        domain: short,
        definition: z.string().max(1000),
        mentions: z
          .array(evidenceRef.extend({ surface: short }))
          .min(1)
          .max(8),
      }),
    )
    .max(35),
  relations: z
    .array(
      z.object({
        source: short,
        target: short,
        type: z.enum([
          'uses',
          'depends',
          'supports',
          'contradicts',
          'limits',
          'compares',
          'association',
          // 与 relationNames 保持一致：把「在…上训练/评估」与「实际使用」分开。
          'trainedOn',
          'evaluatedOn',
        ]),
        condition: z.string().max(1200),
        evidence: z.array(evidenceRef).min(1).max(6),
      }),
    )
    .max(50),
});
export const supportSchema = z.object({
  checks: z
    .array(
      z.object({
        index: z.number().int().min(0),
        support: z.enum(['supported', 'partial', 'conflict', 'unknown']),
        reason: z.string().max(1500),
      }),
    )
    .max(50),
});
export const bridgeSchema = z.object({
  bridges: z
    .array(
      z.object({
        source: short,
        target: short,
        question: short,
        mapping: z.string().min(1).max(1500),
        differences: z.string().min(1).max(1500),
        risks: z.string().min(1).max(1500),
        experiment: z.string().min(1).max(1500),
        evidenceIds: z.array(short).min(2).max(8),
        relationIds: z.array(short).max(8),
      }),
    )
    .max(6),
});
export async function sha256(value: string | ArrayBuffer) {
  const bytes =
    typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  )
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export function contextText(p: Project) {
  return JSON.stringify({
    version: p.state.contextVersion ?? 1,
    question: p.question,
    profile: p.state.profile ?? {},
  });
}
/**
 * 是否能在**所引块**内找到这段摘录。
 * 口径与 lib/evidence.ts 的有限归一化一致（换行、行末断词、空白、连字符），
 * 不再删掉全部空白，也不做任何重排，避免跨栏拼接的无关文字误通过。
 */
export function quoteExists(
  blocks: Block[],
  ref: { blockId: string; quote: string },
) {
  const b = blocks.find((b) => b.id === ref.blockId);
  if (!b) return false;
  const folded = foldForMatch(ref.quote);
  return folded.length >= 3 && foldForMatch(b.text).includes(folded);
}
export function checkedExtraction(
  raw: z.infer<typeof graphExtractionSchema>,
  paper: Paper,
  blocks: Block[],
  parseHash: string,
  runId: string,
  checks: z.infer<typeof supportSchema>['checks'] = [],
) {
  const entities: Entity[] = [],
    evidence: Evidence[] = [],
    mentions: Mention[] = [],
    relations: Relation[] = [];
  const keys = new Map<string, string>(),
    warnings: string[] = [],
    isolated: IsolatedCandidate[] = [];
  const nameByKey = new Map(raw.entities.map((e) => [e.key, e.name]));
  const pageOf = (ref: { blockId?: string }) =>
    blocks.find((b) => b.id === ref.blockId)?.page ?? null;
  function addEvidence(ref: { blockId: string; quote: string }) {
    // 用统一校验定位：可能校正 blockId，并把摘录换成原文中真实存在的连续子串。
    const found = resolveEvidence(blocks, ref);
    if (!found.ok) return null;
    const existing = evidence.find(
      (e) => e.blockId === found.blockId && e.quote === found.text,
    );
    if (existing) return existing.id;
    const id = crypto.randomUUID();
    evidence.push({
      id,
      paperId: paper.id,
      documentHash: paper.hash,
      parseHash,
      blockId: found.blockId,
      page: found.page,
      quote: found.text,
      rect: blocks.find((b) => b.id === found.blockId)?.rect,
      runId,
      ...(found.crossColumnSuspect ? { layoutRisk: true } : {}),
      // 旧版解析（v2）的双栏页：摘录只在交错文本里连贯，界面上要标「原文摘录待核对」。
      ...(paper.parsing?.engine !== 'pdfjs-layout-v3' &&
      paper.parsing?.pages.some(
        (pg) => pg.page === found.page && pg.layout === 'two-column',
      )
        ? { excerptNeedsReview: true }
        : {}),
      ...(found.relocated
        ? { relocatedFrom: { blockId: ref.blockId, page: pageOf(ref) } }
        : {}),
    });
    return id;
  }
  for (const entity of raw.entities) {
    if (keys.has(entity.key))
      throw new Error('模型返回重复实体编号，结果未保存。');
    /**
     * 实体提及的两道检查：
     * 1. 片段本身要在原文里定位得到；
     * 2. 片段正文里要有该名称的逐字写法。
     * 第 2 步以前用「去掉空白再比对」，遇到 PDF 的连字符断行会误杀——
     * 实测 EgoPressure 的 `Pres-\nsureFormer` 因此被判成"实体不存在"。
     * 现在改用 foldForMatch：只合并行末断词，仍然要求逐字出现。
     */
    const judged = entity.mentions.map((m) => {
      const found = resolveEvidence(blocks, m);
      if (!found.ok)
        return { ok: false as const, rule: 'mention-not-locatable' as const, m, reason: found.reason, page: null as number | null };
      if (!foldForMatch(found.text).includes(foldForMatch(m.surface)))
        return {
          ok: false as const,
          rule: 'surface-not-in-excerpt' as const,
          m,
          reason: `该片段（第 ${found.page} 页）里找不到名称「${m.surface}」的逐字写法。`,
          page: found.page,
        };
      return { ok: true as const, m, found };
    });
    const valid = judged.filter((j) => j.ok);
    if (!valid.length) {
      const first = judged[0];
      const rule = first.ok ? 'mention-not-locatable' : first.rule;
      const reason = first.ok ? '片段无法定位。' : first.reason;
      const page = first.ok ? null : first.page;
      warnings.push(`实体“${entity.name}”缺少原文提及，已隔离。`);
      isolated.push({
        kind: 'entity',
        label: entity.name,
        detail: String(entity.definition ?? '').slice(0, 120),
        rule,
        reason: `实体「${entity.name}」没有可用的原文提及：${reason}`,
        paperId: paper.id,
        paperTitle: paper.title,
        page,
        quote: String(first.m.quote ?? '').slice(0, 160),
      });
      continue;
    }
    const id = crypto.randomUUID();
    keys.set(entity.key, id);
    entities.push({
      id,
      name: entity.name,
      type: entity.type,
      aliases: entity.aliases,
      domain: entity.domain,
      definition: entity.definition,
      paperIds: [paper.id],
    });
    for (const item of valid)
      mentions.push({
        id: crypto.randomUUID(),
        entityId: id,
        evidenceId: addEvidence({ blockId: item.found.blockId, quote: item.found.text })!,
        surface: item.m.surface,
      });
  }
  raw.relations.forEach((r, index) => {
    const source = keys.get(r.source),
      target = keys.get(r.target);
    const label = `${nameByKey.get(r.source) ?? r.source} —${relationNames[r.type] ?? r.type}→ ${nameByKey.get(r.target) ?? r.target}`;
    const base = {
      kind: 'relation' as const,
      label,
      paperId: paper.id,
      paperTitle: paper.title,
      detail: String(r.condition ?? ''),
      quote: String(r.evidence?.[0]?.quote ?? ''),
    };
    if (!source || !target) {
      const missing = !source ? r.source : r.target;
      const reason = `关系端点「${nameByKey.get(missing) ?? missing}」没有通过原文提及检查，该关系已隔离。`;
      warnings.push(`关系 ${index + 1} 未通过端点检查，已隔离。`);
      isolated.push({
        ...base,
        rule: 'endpoint-missing',
        reason,
        page: pageOf(r.evidence?.[0] ?? {}),
      });
      return;
    }
    if (source === target) {
      const reason = '关系两端指向同一实体（自环），已隔离。';
      warnings.push(`关系 ${index + 1} 为自环，已隔离。`);
      isolated.push({ ...base, rule: 'self-loop', reason, page: pageOf(r.evidence?.[0] ?? {}) });
      return;
    }
    const missing = r.evidence.filter((e) => !resolveEvidence(blocks, e).ok);
    if (missing.length) {
      const page = pageOf(missing[0]);
      const reason = `摘录在模型所引块（${page ? `第 ${page} 页` : '块编号缺失'}）内找不到连续原文，已隔离。`;
      warnings.push(`关系 ${index + 1} 未通过摘录检查，已隔离。`);
      isolated.push({ ...base, rule: 'evidence-not-found', reason, page, quote: missing[0].quote });
      return;
    }
    const matched = checks.filter((c) => c.index === index);
    const check = matched.length === 1 ? matched[0] : undefined;
    const structureIssue =
      r.type === 'compares' &&
      entities.find((e) => e.id === source)?.type !==
        entities.find((e) => e.id === target)?.type
        ? '对比关系端点类型不一致，请核对比较对象。'
        : '';
    const newRelation: Relation = {
      id: crypto.randomUUID(),
      source,
      target,
      type: r.type,
      condition: r.condition,
      evidenceIds: r.evidence.map((e) => addEvidence(e)!),
      status: 'candidate',
      support: structureIssue ? 'unknown' : (check?.support ?? 'unknown'),
      reason:
        structureIssue || check?.reason || '尚无语义支持检查，需人工核对。',
      runId,
    };
    // 关系动作复核：类型是否真的表达了原文动作（只标记，不改写 type）。
    // 只有真正跑过语义支持检查时才把 support 纳入判定，否则会把
    // 「尚未检查」误报成「依据不足」。
    const review = reviewRelationType(
      checks.length
        ? newRelation
        : { type: newRelation.type, condition: newRelation.condition },
      entities.find((e) => e.id === target),
    );    if (review.status === 'needs-review')
      newRelation.typeReview = {
        status: 'needs-review',
        suggested: review.suggested,
        reason: review.reason,
        at: new Date().toISOString(),
      };
    relations.push(newRelation);
  });
  return { entities, evidence, mentions, relations, warnings, isolated };
}
export function activeEntity(g: Pick<Graph, 'entities'>, id: string): string {
  const seen = new Set<string>();
  while (!seen.has(id)) {
    seen.add(id);
    const next = g.entities.find((e) => e.id === id)?.mergedInto;
    if (!next) return id;
    id = next;
  }
  throw new Error('实体合并形成循环。');
}
export function entityPaperIds(g: Graph, ids: string[]) {
  const canonical = new Set(ids.map((id) => activeEntity(g, id)));
  return [
    ...new Set(
      g.entities
        .filter((e) => canonical.has(activeEntity(g, e.id)))
        .flatMap((e) => e.paperIds),
    ),
  ];
}
export function editEntityDetails(
  g: Graph,
  id: string,
  changes: Partial<
    Pick<Entity, 'name' | 'aliases' | 'type' | 'domain' | 'definition'>
  >,
) {
  const entity = g.entities.find((e) => e.id === id);
  if (!entity) throw new Error('实体不存在。');
  const canonical = activeEntity(g, id);
  const changed = Object.entries(changes).some(
    ([key, value]) =>
      value !== undefined &&
      JSON.stringify(entity[key as keyof Entity]) !== JSON.stringify(value),
  );
  if (!changed) return;
  for (const [key, value] of Object.entries(changes))
    if (value !== undefined) Object.assign(entity, { [key]: value });
  const affected = g.relations.filter(
    (r) =>
      activeEntity(g, r.source) === canonical ||
      activeEntity(g, r.target) === canonical,
  );
  for (const relation of affected) {
    if (relation.status !== 'rejected') relation.status = 'stale';
    relation.support = 'unknown';
    relation.reason = '实体含义或类型已纠正，请重新核对关系及其原文依据。';
  }
  const relationIds = new Set(affected.map((r) => r.id));
  for (const bridge of g.bridges)
    if (
      activeEntity(g, bridge.source) === canonical ||
      activeEntity(g, bridge.target) === canonical ||
      bridge.relationIds.some((rid) => relationIds.has(rid))
    )
      bridge.status = 'stale';
}
export function visibleRelations(
  g: Graph,
  network = 'concept',
  review = 'all',
) {
  return g.relations
    .filter(
      (r) =>
        r.status !== 'rejected' &&
        (review === 'all' || r.status === review) &&
        (network !== 'evidence' ||
          ['supports', 'contradicts', 'limits'].includes(r.type)),
    )
    .map((r) => ({
      ...r,
      ...(relationTypeIssue(g, r)
        ? { support: 'unknown' as const, reason: relationTypeIssue(g, r) }
        : {}),
      source: activeEntity(g, r.source),
      target: activeEntity(g, r.target),
    }))
    .filter((r) => r.source !== r.target);
}
export function relationTypeIssue(g: Pick<Graph, 'entities'>, r: Relation) {
  if (
    r.type === 'compares' &&
    g.entities.find((e) => e.id === activeEntity(g, r.source))?.type !==
      g.entities.find((e) => e.id === activeEntity(g, r.target))?.type
  )
    return '关系端点类型不一致：方法与研究任务不是两个可对比的方法。请核对实体类型和关系含义。';
  return '';
}
export function neighborhood(
  relations: Relation[],
  focus: string,
  depth = 1,
  limit = 40,
) {
  const ids = new Set<string>(focus ? [focus] : []);
  for (let i = 0; i < Math.min(3, Math.max(1, depth)); i++) {
    const previous = new Set(ids);
    for (const r of relations)
      if (previous.has(r.source) || previous.has(r.target))
        for (const id of [r.source, r.target])
          if (ids.size < limit) ids.add(id);
  }
  return ids;
}
export function evidencePath(
  relations: Relation[],
  source: string,
  target: string,
  maxLength = 4,
) {
  if (source === target) return [];
  const queue: { id: string; path: Relation[] }[] = [{ id: source, path: [] }],
    visited = new Set([source]);
  while (queue.length) {
    const item = queue.shift()!;
    if (item.path.length >= maxLength) continue;
    for (const r of relations.filter(
      (r) =>
        r.source === item.id &&
        r.status === 'confirmed' &&
        r.support === 'supported' &&
        r.type !== 'association',
    )) {
      if (r.target === target) return [...item.path, r];
      if (!visited.has(r.target)) {
        visited.add(r.target);
        queue.push({ id: r.target, path: [...item.path, r] });
      }
    }
  }
  return null;
}
export function jobCounts(jobs: { status: string }[]) {
  const count = (status: string) =>
    jobs.filter((j) => j.status === status).length;
  return {
    total: jobs.length,
    ended: jobs.filter((j) =>
      ['succeeded', 'partial', 'failed', 'cancelled'].includes(j.status),
    ).length,
    succeeded: count('succeeded'),
    partial: count('partial'),
    failed: count('failed'),
    cancelled: count('cancelled'),
    running: count('running'),
    queued: count('queued'),
  };
}
export function invalidateBridges(g: Graph, relationIds: string[] = []) {
  for (const b of g.bridges)
    if (
      !relationIds.length ||
      b.relationIds.some((id) => relationIds.includes(id))
    )
      b.status = 'stale';
}
