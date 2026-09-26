import { z } from 'zod';
import { invalidateExperimentObservations } from './observations';
import { buildExperimentStatistics } from './experiment-statistics';
import {
  calculateComparison,
  comparisonAssumptionsSchema,
  multiplicitySchema,
} from './experiment-comparison';
import {
  calculateMeanInterval,
  intervalAssumptionsSchema,
} from './experiment-interval';
import {
  reproducibilitySchema,
  saveReproducibility,
} from './experiment-reproducibility';
import {
  assertScopeMatches,
  experimentScopesSchema,
  saveExperimentScopes,
} from './experiment-scope';
import {
  uid,
  now,
  logActivity,
  editCell,
  addRule,
  cellSnapshot,
  refreshClaims,
  evaluateClaim,
  validateRows,
  ensureCells,
  type Project,
  type Claim,
  type Cell,
} from './domain';
import { ApiError, getBlocks } from './server';
import { saveManuscript } from './manuscript';
import {
  candidateDifference,
  applyCandidateDecision,
  recordCandidateDecision,
} from './candidate-review';
import { quoteExists } from './graph';
import { captureSource, rebindNote } from './source-reference';
import {
  makeCitationBinding,
  saveCitation,
  withdrawCitation,
} from './manuscript-citations';
const text = z.string().max(5000),
  short = z.string().max(1800);
export const profileSchema = z.object({
  equipment: short,
  currentMethod: short,
  constraints: short,
});
const row = z.object({
  runId: z.string().trim().min(1).max(80).optional(),
  method: z.string().min(1).max(150),
  dataset: z.string().min(1).max(150),
  metric: z.string().min(1).max(150),
  value: z.number(),
});
export const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('experiment.comparison'),
    id: z.string(),
    versionId: z.string(),
    methodA: z.string().min(1).max(150),
    methodB: z.string().min(1).max(150),
    dataset: z.string().min(1).max(150),
    metric: z.string().min(1).max(150),
    design: z.enum(['welch', 'paired']),
    assumptions: comparisonAssumptionsSchema,
    multiplicity: multiplicitySchema,
    reason: z.string().trim().min(1).max(1200),
  }),
  z.object({
    action: z.literal('experiment.interval'),
    id: z.string(),
    versionId: z.string(),
    method: z.string().min(1).max(150),
    dataset: z.string().min(1).max(150),
    metric: z.string().min(1).max(150),
    assumptions: intervalAssumptionsSchema,
    reason: z.string().trim().min(1).max(1200),
  }),
  z.object({
    action: z.literal('review.citation.save'),
    id: z.string().optional(),
    sourceRevision: z.number().int(),
    manuscriptVersionId: z.string(),
    manuscriptText: z.string().trim().min(1).max(3000),
    paperId: z.string(),
    blockId: z.string(),
    parseHash: z.string().length(64),
    quote: z.string().trim().min(1).max(6000),
    reason: z.string().trim().min(1).max(1200),
  }),
  z.object({
    action: z.literal('review.citation.withdraw'),
    id: z.string(),
    sourceRevision: z.number().int(),
    reason: z.string().trim().min(1).max(1200),
  }),
  z.object({
    action: z.literal('note.source'),
    id: z.string(),
    blockId: z.string().min(1),
    parseHash: z.string().length(64),
    quote: z.string().trim().min(1).max(6000),
    reason: z.string().trim().min(1).max(1200),
  }),
  z.object({
    action: z.literal('project.edit'),
    title: z.string().min(1).max(100),
    question: text,
    profile: profileSchema.optional(),
  }),
  z.object({
    action: z.literal('field.save'),
    id: z.string().optional(),
    name: z.string().min(1).max(60),
    definition: short,
  }),
  z.object({
    action: z.literal('cell.edit'),
    id: z.string(),
    value: short,
    reason: short,
    blockId: z.string(),
    quote: z.string().max(2000),
  }),
  z.object({
    action: z.literal('cell.accept'),
    id: z.string(),
    reason: short.optional(),
  }),
  z.object({
    action: z.literal('cell.reject'),
    id: z.string(),
    reason: short.optional(),
  }),
  z.object({
    action: z.literal('candidate.batch'),
    ids: z.array(z.string()).min(1).max(100),
    decision: z.enum(['accept', 'retain']),
    reason: z.string().trim().min(1).max(1800),
    reviewRevision: z.number().int().positive(),
  }),
  z.object({
    action: z.literal('cell.restore'),
    id: z.string(),
    index: z.number().int().nonnegative(),
  }),
  z.object({
    action: z.literal('rule.add'),
    fieldId: z.string(),
    instruction: z.string().min(3).max(1500),
  }),
  z.object({
    action: z.literal('note.add'),
    parseHash: z.string().length(64).optional(),
    parseVersionId: z.string().optional(),
    quote: z.string().min(1).max(6000).optional(),
    paperId: z.string(),
    blockId: z.string(),
    text: z.string().min(1).max(3000),
  }),
  z.object({
    action: z.literal('reading.feedback'),
    id: z.string().optional(),
    paperIds: z.array(z.string()).min(1).max(20),
    text: z.string().min(1).max(5000),
    status: z.enum(['tried', 'unsuitable', 'verify']),
    reason: z.string().min(1).max(1500),
  }),
  z.object({ action: z.literal('reading.feedback.remove'), id: z.string() }),
  z.object({
    action: z.literal('experiment.save'),
    id: z.string().optional(),
    name: z.string().min(1).max(100),
    filename: z.string().max(160),
    direction: z.enum(['higher', 'lower']),
    rows: z.array(row).min(1).max(2000),
  }),
  z.object({
    action: z.literal('experiment.reproducibility'),
    id: z.string(),
    versionId: z.string(),
    metadata: reproducibilitySchema,
    reason: z.string().trim().min(1).max(1200),
  }),
  z.object({
    action: z.literal('experiment.scope'),
    id: z.string(),
    versionId: z.string(),
    values: experimentScopesSchema,
    reason: z.string().trim().min(1).max(1200),
  }),
  z.object({
    action: z.literal('claim.add'),
    text: z.string().min(1).max(1000),
    experimentId: z.string(),
    method: z.string(),
    otherMethod: z.string(),
    dataset: z.string(),
    metric: z.string(),
    relation: z.enum(['higher', 'lower', 'equal', 'number']),
    expected: z.number().nullable(),
  }),
  z.object({ action: z.literal('claim.confirm'), id: z.string() }),
  z.object({ action: z.literal('claim.remove'), id: z.string() }),
  z.object({
    action: z.literal('review.save'),
    oldText: z.string().max(18000),
    newText: z.string().max(18000),
    feedback: z.string().max(8000),
  }),
  z.object({ action: z.literal('review.manual') }),
  z.object({ action: z.literal('review.restore'), id: z.string() }),
  z.object({
    action: z.literal('review.item'),
    id: z.string(),
    status: z.enum(['open', 'partial', 'review', 'done']),
    confirmation: z.string().max(3000),
    evidence: z.string().max(3000),
  }),
]);
export async function act(p: Project, owner: string, input: unknown) {
  const parsed = actionSchema.safeParse(input);
  if (!parsed.success) throw new ApiError('填写内容不完整或超出长度限制。');
  const a = parsed.data,
    s = p.state;
  switch (a.action) {
    case 'review.citation.save': {
      if (
        a.sourceRevision !== p.revision ||
        a.manuscriptVersionId !== (s.review.versions?.at(-1)?.id ?? 'legacy')
      )
        throw new ApiError('稿件或课题版本已变化，请重新核对。', 409);
      const paper = s.papers.find((p) => p.id === a.paperId);
      if (!paper) throw new ApiError('原文献不存在。', 404);
      const blocks = await getBlocks(owner, p.id, paper.id);
      try {
        const source = await captureSource(paper, blocks, a.blockId, a.quote);
        if (source.parseHash !== a.parseHash)
          throw new ApiError('解析版本已变化，请重新核对。', 409);
        saveCitation(
          s.review,
          await makeCitationBinding(
            s.review,
            a.manuscriptText,
            source,
            owner,
            a.reason,
          ),
          a.id,
        );
      } catch (e) {
        if (e instanceof ApiError) throw e;
        throw new ApiError((e as Error).message);
      }
      logActivity(s, '核对稿件原文引用：' + a.reason);
      break;
    }
    case 'review.citation.withdraw': {
      if (a.sourceRevision !== p.revision)
        throw new ApiError('课题已更新，请重新打开引用。', 409);
      try {
        withdrawCitation(s.review, a.id, owner, a.reason);
      } catch (e) {
        throw new ApiError((e as Error).message);
      }
      logActivity(s, '撤回稿件引用：' + a.reason);
      break;
    }
    case 'project.edit':
      if (
        p.question !== a.question ||
        (a.profile &&
          JSON.stringify(s.profile ?? {}) !== JSON.stringify(a.profile))
      )
        s.contextVersion = (s.contextVersion ?? 1) + 1;
      p.title = a.title;
      p.question = a.question;
      if (a.profile) s.profile = a.profile;
      break;
    case 'reading.feedback': {
      if (a.paperIds.some((id) => !s.papers.some((paper) => paper.id === id)))
        throw new ApiError('反馈关联的文献不存在。');
      const records = (s.readingFeedback ??= []);
      if (a.id && !records.some((r) => r.id === a.id))
        throw new ApiError('反馈不存在。');
      if (!a.id && records.length >= 100)
        throw new ApiError('每个课题最多保存 100 条阅读反馈。');
      const item = {
        id: a.id ?? uid(),
        paperIds: [...new Set(a.paperIds)],
        text: a.text,
        status: a.status,
        reason: a.reason,
        at: now(),
      };
      if (a.id) records[records.findIndex((r) => r.id === a.id)] = item;
      else records.push(item);
      logActivity(s, '更新阅读反馈，后续课题分析会参考此记录。');
      break;
    }
    case 'reading.feedback.remove':
      s.readingFeedback = (s.readingFeedback ?? []).filter(
        (r) => r.id !== a.id,
      );
      logActivity(s, '移除阅读反馈。');
      break;
    case 'field.save': {
      if (a.id) {
        const f = s.fields.find((f) => f.id === a.id);
        if (!f) throw new ApiError('字段不存在。');
        f.name = a.name;
        f.definition = a.definition;
        f.version++;
        s.cells
          .filter((c) => c.fieldId === a.id)
          .forEach((c) => {
            c.status = 'stale';
            delete c.candidate;
          });
      } else {
        if (s.fields.length >= 15)
          throw new ApiError('首版最多支持 15 个字段。');
        s.fields.push({
          id: uid(),
          name: a.name,
          definition: a.definition,
          version: 1,
        });
      }
      logActivity(s, '更新字段：' + a.name);
      break;
    }
    case 'cell.edit': {
      const c = s.cells.find((c) => c.id === a.id);
      if (!c) throw new ApiError('单元格不存在。');
      const before = cellSnapshot(c),
        candidate = c.candidate ? cellSnapshot(c.candidate) : null,
        beforeStatus = c.status;
      editCell(s, a.id, a, await getBlocks(owner, p.id, c.paperId));
      if (candidate)
        recordCandidateDecision(
          s,
          c,
          before,
          candidate,
          beforeStatus,
          'manual',
          owner,
          a.reason || '编辑后人工核对',
        );
      logActivity(s, '人工核对并保存一个单元格。');
      break;
    }
    case 'cell.accept': {
      const c = s.cells.find((c) => c.id === a.id);
      if (!c?.candidate) throw new ApiError('没有待接受的提取结果。');
      if (!c.candidate.sourceValid || !c.candidate.value)
        throw new ApiError('候选没有有效原文依据，不能进入已确认矩阵。');
      const field = s.fields.find((f) => f.id === c.fieldId)!;
      const rule =
        s.rules.filter((r) => r.fieldId === c.fieldId).at(-1)?.version ?? 0;
      if (
        c.candidate.fieldVersion !== field.version ||
        c.candidate.ruleVersion !== rule
      )
        throw new ApiError('候选结果对应旧规则，请重新提取。');
      const blocks = await getBlocks(owner, p.id, c.paperId);
      if (
        !quoteExists(blocks, c.candidate) ||
        blocks.find((b) => b.id === c.candidate!.blockId)?.page !==
          c.candidate.page
      )
        throw new ApiError('候选原文来源已失效，请重新核对。');
      applyCandidateDecision(
        s,
        c,
        'accept',
        owner,
        a.reason?.trim() || '逐项接受复查结果',
      );
      logActivity(s, '接受复查结果，保留原值历史。');
      break;
    }
    case 'cell.reject': {
      const c = s.cells.find((c) => c.id === a.id);
      if (!c) throw new ApiError('单元格不存在。');
      if (!c.candidate) throw new ApiError('没有待处理候选。');
      applyCandidateDecision(
        s,
        c,
        'retain',
        owner,
        a.reason?.trim() || '逐项保留原值',
      );
      logActivity(s, '拒绝复查候选，保留当前值与待复查状态。');
      break;
    }
    case 'candidate.batch': {
      if (a.reviewRevision !== p.revision)
        throw new ApiError('课题在预览后已更新，请刷新候选预览再操作。', 409);
      if (new Set(a.ids).size !== a.ids.length)
        throw new ApiError('不能重复选择同一候选。');
      const cells = a.ids.map((id) => s.cells.find((c) => c.id === id));
      if (cells.some((c) => !c?.candidate))
        throw new ApiError('所选候选不属于当前课题或已更新，请刷新。', 409);
      if (a.decision === 'accept') {
        for (const cell of cells as Cell[]) {
          if (!candidateDifference(s, cell)?.batchAcceptable)
            throw new ApiError(
              '包含数值、条件、来源或警告变化，请逐项核对；本批未写入。',
            );
          const blocks = await getBlocks(owner, p.id, cell.paperId);
          if (
            !quoteExists(blocks, cell.candidate!) ||
            blocks.find((b) => b.id === cell.candidate!.blockId)?.page !==
              cell.candidate!.page
          )
            throw new ApiError('候选来源检查失败，本批未写入。');
        }
      }
      const batchId = uid();
      for (const cell of cells as Cell[])
        applyCandidateDecision(s, cell, a.decision, owner, a.reason, batchId);
      logActivity(
        s,
        `批量${a.decision === 'accept' ? '接受候选' : '保留原值'}：${cells.length}项；原因：${a.reason}`,
      );
      break;
    }
    case 'cell.restore': {
      const c = s.cells.find((c) => c.id === a.id),
        h = c?.history[a.index];
      if (!c || !h) throw new ApiError('历史版本不存在。');
      const restored = { ...h.value };
      c.history.push({
        at: now(),
        value: cellSnapshot(c),
        status: c.status,
        reason: '恢复历史值',
      });
      Object.assign(c, restored, {
        evidenceRef: restored.evidenceRef,
        status: 'stale' as Cell['status'],
      });
      delete c.candidate;
      logActivity(s, '恢复历史值并标为待复查。');
      break;
    }
    case 'rule.add':
      addRule(s, a.fieldId, a.instruction);
      break;
    case 'note.add': {
      if (s.notes.length >= 200)
        throw new ApiError('首版每课题最多保存 200 条笔记。');
      if (!s.papers.some((x) => x.id === a.paperId))
        throw new ApiError('文献不存在。');
      const blocks = await getBlocks(owner, p.id, a.paperId);
      if (a.blockId && !blocks.some((b) => b.id === a.blockId))
        throw new ApiError('原文位置不存在。');
      let source;
      if (a.blockId) {
        try {
          source = await captureSource(
            s.papers.find((x) => x.id === a.paperId)!,
            blocks,
            a.blockId,
            a.quote,
          );
        } catch (e) {
          throw new ApiError((e as Error).message);
        }
        if (
          (a.parseHash && a.parseHash !== source.parseHash) ||
          (a.parseVersionId && a.parseVersionId !== source.parseVersionId)
        )
          throw new ApiError(
            '回答引用的解析版本已变化，请重新提问或核对来源。',
            409,
          );
      }
      s.notes.push({
        id: uid(),
        paperId: a.paperId,
        blockId: a.blockId,
        text: a.text,
        at: now(),
        ...(source ? { source } : {}),
      });
      s.contextVersion = (s.contextVersion ?? 1) + 1;
      logActivity(s, '保存阅读笔记。');
      break;
    }
    case 'note.source': {
      const note = s.notes.find((n) => n.id === a.id);
      const paper = note && s.papers.find((p) => p.id === note.paperId);
      if (!note || !paper) throw new ApiError('笔记或原文献不存在。', 404);
      const blocks = await getBlocks(owner, p.id, paper.id);
      try {
        const source = await captureSource(paper, blocks, a.blockId, a.quote);
        if (source.parseHash !== a.parseHash)
          throw new ApiError('解析版本已变化，请重新核对。', 409);
        rebindNote(note, source, owner, now(), a.reason);
      } catch (e) {
        if (e instanceof ApiError) throw e;
        throw new ApiError((e as Error).message);
      }
      s.contextVersion = (s.contextVersion ?? 1) + 1;
      logActivity(s, '重新核对笔记原文来源：' + a.reason);
      break;
    }
    case 'experiment.comparison': {
      const experiment = s.experiments.find((e) => e.id === a.id);
      if (!experiment) throw new ApiError('实验不存在。', 404);
      if (experiment.versions.at(-1)?.id !== a.versionId)
        throw new ApiError('实验版本已变化，请重新选择。', 409);
      if ((experiment.comparisons?.length ?? 0) >= 50)
        throw new ApiError('每个实验最多50条比较记录，已有记录未覆盖。');
      try {
        assertScopeMatches(
          experiment,
          a.versionId,
          a.dataset,
          a.metric,
          a.assumptions,
        );
        const result = await calculateComparison(
          experiment,
          a.versionId,
          {
            methodA: a.methodA,
            methodB: a.methodB,
            dataset: a.dataset,
            metric: a.metric,
            design: a.design,
          },
          a.assumptions,
          a.multiplicity,
          owner,
          a.reason,
        );
        experiment.comparisons = [...(experiment.comparisons ?? []), result];
      } catch (e) {
        throw new ApiError((e as Error).message);
      }
      logActivity(s, '保存两组比较及统计前提、配对与多重比较计划。');
      break;
    }
    case 'experiment.interval': {
      const experiment = s.experiments.find((e) => e.id === a.id);
      if (!experiment) throw new ApiError('实验不存在。', 404);
      if (experiment.versions.at(-1)?.id !== a.versionId)
        throw new ApiError('实验版本已变化，请重新选择。', 409);
      if ((experiment.intervals?.length ?? 0) >= 50)
        throw new ApiError('每个实验最多保存50条区间计算，旧记录未覆盖。');
      try {
        assertScopeMatches(
          experiment,
          a.versionId,
          a.dataset,
          a.metric,
          a.assumptions,
        );
        const interval = await calculateMeanInterval(
          experiment,
          a.versionId,
          { method: a.method, dataset: a.dataset, metric: a.metric },
          a.assumptions,
          owner,
          a.reason,
        );
        experiment.intervals = [...(experiment.intervals ?? []), interval];
      } catch (e) {
        throw new ApiError((e as Error).message);
      }
      logActivity(s, '保存均值95%置信区间及人工填写的统计前提。');
      break;
    }
    case 'experiment.reproducibility': {
      const experiment = s.experiments.find((e) => e.id === a.id);
      if (!experiment) throw new ApiError('实验不存在。', 404);
      if (experiment.versions.at(-1)?.id !== a.versionId)
        throw new ApiError('实验版本已变化，请重新核对。', 409);
      try {
        await saveReproducibility(
          experiment,
          a.versionId,
          a.metadata,
          owner,
          a.reason,
        );
      } catch (e) {
        throw new ApiError((e as Error).message);
      }
      invalidateExperimentObservations(s, experiment.id);
      refreshClaims(s, experiment.id);
      logActivity(s, '保存实验复现信息，新建版本并保留旧记录：' + a.reason);
      break;
    }
    case 'experiment.scope': {
      const experiment = s.experiments.find((e) => e.id === a.id);
      if (!experiment) throw new ApiError('实验不存在。', 404);
      if (experiment.versions.at(-1)?.id !== a.versionId)
        throw new ApiError('实验版本已变化，请重新核对。', 409);
      try {
        await saveExperimentScopes(
          experiment,
          a.versionId,
          a.values,
          owner,
          a.reason,
        );
      } catch (e) {
        throw new ApiError((e as Error).message);
      }
      invalidateExperimentObservations(s, experiment.id);
      refreshClaims(s, experiment.id);
      logActivity(
        s,
        '保存指标单位、观测单位与实验条件，新建版本并保留旧记录：' + a.reason,
      );
      break;
    }
    case 'experiment.save': {
      validateRows(a.rows);
      const version = {
        id: uid(),
        at: now(),
        filename: a.filename,
        rows: a.rows,
        statistics: await buildExperimentStatistics(a.rows),
      };
      if (a.id) {
        const exp = s.experiments.find((e) => e.id === a.id);
        if (!exp) throw new ApiError('实验不存在。');
        if (exp.versions.length >= 10)
          throw new ApiError('首版每个实验最多 10 个版本。');
        exp.name = a.name;
        exp.direction = a.direction;
        exp.versions.push(version);
        invalidateExperimentObservations(s, exp.id);
        refreshClaims(s, exp.id);
      } else {
        if (s.experiments.length >= 5)
          throw new ApiError('首版最多 5 个实验。');
        s.experiments.push({
          id: uid(),
          name: a.name,
          direction: a.direction,
          versions: [version],
        });
      }
      logActivity(s, '导入实验数据：' + a.name);
      break;
    }
    case 'claim.add': {
      if (s.claims.length >= 100)
        throw new ApiError('最多关联 100 条结果描述。');
      const exp = s.experiments.find((e) => e.id === a.experimentId);
      if (!exp) throw new ApiError('实验不存在。');
      if (a.relation === 'number' && a.expected === null)
        throw new ApiError('请输入要核对的数值。');
      const c: Claim = {
        ...a,
        id: uid(),
        checkedVersion: exp.versions.at(-1)!.id,
        result: 'missing',
        detail: '',
        needsReview: false,
      };
      Object.assign(c, evaluateClaim(c, exp));
      s.claims.push(c);
      logActivity(s, '关联一条结果描述与实验数据。');
      break;
    }
    case 'claim.confirm': {
      const c = s.claims.find((c) => c.id === a.id);
      if (!c) throw new ApiError('描述不存在。');
      if (c.result !== 'pass')
        throw new ApiError(
          '数据尚不支持这条描述，请修改描述或核查数据后再确认。',
        );
      c.checkedVersion = s.experiments
        .find((e) => e.id === c.experimentId)!
        .versions.at(-1)!.id;
      c.needsReview = false;
      logActivity(s, '确认数据更新后的结果描述。');
      break;
    }
    case 'claim.remove':
      s.claims = s.claims.filter((c) => c.id !== a.id);
      logActivity(s, '解除一条描述的数据关联。');
      break;
    case 'review.save': {
      if (saveManuscript(s.review, a, owner))
        logActivity(s, '保存稿件版本，旧的意见核对结果进入历史。');
      break;
    }
    case 'review.restore': {
      const version = s.review.versions?.find((v) => v.id === a.id);
      if (!version) throw new ApiError('稿件版本不存在。');
      saveManuscript(s.review, version, owner, version.id);
      logActivity(s, `恢复稿件v${version.number}，创建新版本并重新核对意见。`);
      break;
    }
    case 'review.manual': {
      const lines = s.review.feedback
        .split(/\n+/)
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 25);
      if (!lines.length) throw new ApiError('请先保存修改意见，每行一条。');
      if (s.review.items.length)
        throw new ApiError('已存在意见清单。请保存新的稿件版本后再建立清单。');
      s.review.items = lines.map((instruction) => ({
        id: uid(),
        instruction,
        evidence: '',
        explanation: '按行建立的人工核对事项，尚未使用 AI 分析。',
        status: 'open',
        confirmation: '',
      }));
      logActivity(s, '按行建立修改清单。');
      break;
    }
    case 'review.item': {
      const item = s.review.items.find((i) => i.id === a.id);
      if (!item) throw new ApiError('意见不存在。');
      if (a.status === 'done' && !a.confirmation.trim())
        throw new ApiError('请填写落实说明再确认完成。');
      if (a.evidence && !s.review.newText.includes(a.evidence))
        throw new ApiError('修改证据必须是新稿中的原文片段。');
      item.status = a.status;
      item.confirmation = a.confirmation;
      item.evidence = a.evidence;
      logActivity(s, '更新修改意见处理状态。');
      break;
    }
  }
  ensureCells(s);
  return p;
}
