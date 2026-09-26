import { z } from 'zod';
import { ApiError, getBlocks, getProject } from './server';
import {
  type Graph,
  quoteExists,
  invalidateBridges,
  activeEntity,
  sha256,
  contextText,
  relationTypeIssue,
  editEntityDetails,
} from './graph';

const reason = z.string().trim().min(1).max(1500);
export const graphActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('relation.review'),
    id: z.string(),
    status: z.enum(['confirmed', 'rejected', 'candidate']),
    reason,
  }),
  z.object({
    action: z.literal('relation.correct'),
    id: z.string(),
    type: z.enum([
      'uses',
      'depends',
      'supports',
      'contradicts',
      'limits',
      'compares',
      'association',
    ]),
    condition: z.string().max(1200),
    support: z.enum(['supported', 'partial', 'conflict', 'unknown']),
    reason,
  }),
  z.object({
    action: z.literal('entity.edit'),
    id: z.string(),
    name: z.string().trim().min(1).max(500),
    aliases: z.array(z.string().trim().min(1).max(500)).max(10),
    type: z
      .enum([
        'problem',
        'concept',
        'hypothesis',
        'formula',
        'method',
        'data',
        'observation',
        'conclusion',
      ])
      .optional(),
    domain: z.string().trim().max(500).optional(),
    definition: z.string().trim().max(2000).optional(),
    reason,
  }),
  z.object({
    action: z.literal('entity.merge'),
    source: z.string(),
    target: z.string(),
    reason,
  }),
  z.object({ action: z.literal('entity.split'), id: z.string(), reason }),
  z.object({
    action: z.literal('evidence.correct'),
    id: z.string(),
    quote: z.string().min(3).max(2000),
    reason,
  }),
  z.object({
    action: z.literal('bridge.review'),
    id: z.string(),
    status: z.enum(['explore', 'tried', 'unsuitable']),
    reason,
  }),
  z.object({
    action: z.literal('view.save'),
    name: z.string().min(1).max(80),
    focus: z.string(),
    query: z.string().max(200),
    type: z.string(),
    review: z.string(),
    network: z.enum(['concept', 'evidence', 'citation']),
    depth: z.number().int().min(1).max(3),
    positions: z.record(
      z.string(),
      z.object({
        x: z.number().min(0).max(1200),
        y: z.number().min(0).max(800),
      }),
    ),
  }),
]);
export async function graphAction(
  g: Graph,
  projectId: string,
  owner: string,
  input: unknown,
) {
  const a = graphActionSchema.parse(input),
    p = await getProject(projectId, owner);
  switch (a.action) {
    case 'relation.review':
    case 'relation.correct': {
      const r = g.relations.find((r) => r.id === a.id);
      if (!r) throw new ApiError('关系不存在。', 404);
      if (a.action === 'relation.review' && a.status === 'confirmed') {
        if (relationTypeIssue(g, r))
          throw new ApiError(relationTypeIssue(g, r));
        if (r.support !== 'supported')
          throw new ApiError(
            '请先核对支持性；部分支持或冲突关系需纠正后再确认。',
          );
        if (!r.evidenceIds.length)
          throw new ApiError('关系缺少原文证据，不能确认。');
        for (const id of r.evidenceIds) {
          const e = g.evidence.find((e) => e.id === id);
          if (!e) throw new ApiError('关系证据记录缺失，不能确认。');
          const blocks = await getBlocks(owner, projectId, e.paperId);
          if (
            !p.state.papers.some(
              (x) => x.id === e.paperId && x.hash === e.documentHash,
            ) ||
            e.parseHash !== (await sha256(JSON.stringify(blocks))) ||
            !quoteExists(blocks, e)
          )
            throw new ApiError('关系证据已失效，请修正原文来源。');
        }
      }
      if (a.action === 'relation.correct') {
        r.type = a.type;
        r.condition = a.condition;
        r.support = a.support;
        r.status = 'candidate';
      } else r.status = a.status;
      r.reason = a.reason;
      invalidateBridges(g, [r.id]);
      break;
    }
    case 'entity.edit': {
      const e = g.entities.find((e) => e.id === a.id);
      if (!e) throw new ApiError('实体不存在。', 404);
      editEntityDetails(g, e.id, {
        name: a.name,
        aliases: a.aliases,
        type: a.type,
        domain: a.domain,
        definition: a.definition,
      });
      break;
    }
    case 'entity.merge': {
      const source = g.entities.find((e) => e.id === a.source),
        target = g.entities.find((e) => e.id === a.target);
      if (
        !source ||
        !target ||
        source.mergedInto ||
        target.mergedInto ||
        source.id === target.id
      )
        throw new ApiError('只能合并两个不同的未合并实体。');
      if (source.type !== target.type)
        throw new ApiError('不同类型的实体不能合并。');
      source.mergedInto = target.id;
      g.relations
        .filter((r) => r.source === source.id || r.target === source.id)
        .forEach((r) => {
          if (r.status === 'confirmed') {
            r.status = 'stale';
            r.reason = '实体合并改变了规范端点，请重新核对。';
          }
        });
      invalidateBridges(g);
      break;
    }
    case 'entity.split': {
      const e = g.entities.find((e) => e.id === a.id);
      if (!e?.mergedInto) throw new ApiError('这个实体没有合并记录。');
      delete e.mergedInto;
      g.relations
        .filter((r) => r.source === e.id || r.target === e.id)
        .forEach((r) => {
          if (r.status === 'confirmed') {
            r.status = 'stale';
            r.reason = '实体拆分后需要重新核对。';
          }
        });
      invalidateBridges(g);
      break;
    }
    case 'evidence.correct': {
      const e = g.evidence.find((e) => e.id === a.id);
      if (!e) throw new ApiError('证据不存在。', 404);
      if (
        !quoteExists(await getBlocks(owner, projectId, e.paperId), {
          ...e,
          quote: a.quote,
        })
      )
        throw new ApiError('修改后的摘录必须存在于同一原文区域。');
      e.quote = a.quote;
      const changed = g.relations.filter((r) => r.evidenceIds.includes(e.id));
      changed.forEach((r) => {
        r.status = 'stale';
        r.support = 'unknown';
        r.reason = '来源证据已纠正，需要重新核对。';
      });
      invalidateBridges(
        g,
        changed.map((r) => r.id),
      );
      g.bridges
        .filter((b) => b.evidenceIds.includes(e.id))
        .forEach((b) => (b.status = 'stale'));
      break;
    }
    case 'bridge.review': {
      const b = g.bridges.find((b) => b.id === a.id);
      if (!b) throw new ApiError('假设不存在。', 404);
      if (b.contextHash !== (await sha256(contextText(p))))
        throw new ApiError('课题条件已经变化，请基于新条件重新生成假设。');
      if (b.status === 'stale')
        throw new ApiError('假设依据已变化，请重新生成并核对。');
      b.status = a.status;
      b.reason = a.reason;
      break;
    }
    case 'view.save': {
      if (a.focus && !g.entities.some((e) => activeEntity(g, e.id) === a.focus))
        throw new ApiError('视图焦点已失效。');
      if (g.views.length >= 30)
        throw new ApiError('每个课题最多保存30个探索视图。');
      g.views.push({ ...a, id: crypto.randomUUID() });
      break;
    }
  }
  return JSON.stringify(a);
}
