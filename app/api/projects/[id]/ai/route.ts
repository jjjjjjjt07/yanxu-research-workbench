import {
  ownerOf,
  mutationGuard,
  json,
  failure,
  readBody,
  getProject,
  getBlocks,
  saveProject,
  ensureRevision,
  ApiError,
} from '@/lib/server';
import { modelJSON, answerSchema, reviewSchema, aiStatus } from '@/lib/ai';
import { uid, logActivity } from '@/lib/domain';
import { researchContext, selectReadingBlocks } from '@/lib/research-context';
import { LIMITS } from '@/lib/limits';
import { supportSchema, sha256 } from '@/lib/graph';
import { saveAnswer } from '@/lib/answer-store';
import { qualifiedSupport, type ReadingAnswer } from '@/lib/reading-answer';
import { parsingContext } from '@/lib/pdf-layout';
import { exactQuote } from '@/lib/exact-quote';
import { loadGraph } from '@/lib/graph-store';
import {
  captureObservationReference,
  validateObservationIndices,
  type ObservationReference,
} from '@/lib/observation-reference';
export const dynamic = 'force-dynamic';
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    mutationGuard(req);
    const owner = await ownerOf(req),
      { id } = await ctx.params,
      body = await readBody(req, 300_000),
      p = await getProject(id, owner);
    if (body.task === 'ask') {
      const ids = Array.isArray(body.paperIds)
        ? [...new Set(body.paperIds)]
        : [body.paperId];
      if (
        !ids.length ||
        ids.length > 20 ||
        ids.some(
          (id) =>
            typeof id !== 'string' || !p.state.papers.some((x) => x.id === id),
        )
      )
        throw new ApiError('请选择当前课题中的 1—20 篇文献。');
      const question = String(body.question || '').slice(0, 3000);
      if (!question.trim()) throw new ApiError('请输入问题。');
      if (body.blockId && ids.length !== 1)
        throw new ApiError('片段问答只能选择一篇文献。');
      const observationIds =
        body.observationIds === undefined ? [] : body.observationIds;
      if (
        !Array.isArray(observationIds) ||
        observationIds.length > 5 ||
        observationIds.some((id) => typeof id !== 'string') ||
        new Set(observationIds).size !== observationIds.length
      )
        throw new ApiError('请选择不超过5条不同的实验观察。');
      const observationGraph = observationIds.length
        ? await loadGraph(id, owner)
        : null;
      const observations: ObservationReference[] = [];
      for (const observationId of observationIds) {
        try {
          observations.push(
            await captureObservationReference(
              p.state,
              observationGraph!,
              observationId,
            ),
          );
        } catch (e) {
          throw new ApiError((e as Error).message, 409);
        }
      }
      const context = researchContext(p, observationIds);
      const budget = Math.floor(LIMITS.modelInputChars.reader / ids.length);
      const documents = await Promise.all(
        ids.map(async (paperId) => {
          const paper = p.state.papers.find((x) => x.id === paperId)!;
          const all = await getBlocks(owner, id, paper.id);
          const parseHash = await sha256(JSON.stringify(all));
          if (paper.parsing && paper.parsing.hash !== parseHash)
            throw new ApiError('解析版本已变化，请刷新后重试。', 409);
          const parsing = parsingContext(paper, all);
          const blocks = body.blockId
            ? all.filter((b) => b.id === body.blockId)
            : selectReadingBlocks(
                all,
                question + ' ' + p.title + ' ' + p.question,
                budget,
              );
          if (!blocks.length)
            throw new ApiError(`文献「${paper.title}」没有可用的原文片段。`);
          return {
            paperId: paper.id,
            documentHash: paper.hash,
            parseHash,
            parseVersionId: paper.parseVersionId ?? 'original',
            title: paper.title,
            blocks,
            totalBlocks: all.length,
            parsing,
            coverage:
              paper.coverage === 'abstract' || paper.coverage === 'metadata'
                ? paper.coverage
                : body.blockId
                  ? 'fragment'
                  : blocks.length === all.length
                    ? paper.kind === 'pdf'
                      ? parsing.qualityWarnings.length
                        ? 'incomplete'
                        : 'parsed'
                      : 'full'
                    : 'excerpts',
          };
        }),
      );
      const finish = async (result: ReadingAnswer) => {
        if (observations.length) result.observations = observations;
        result.sourceNeedsReview =
          (await getProject(id, owner)).revision !== p.revision;
        result.sources = result.sources.map((source) => {
          const doc = documents.find((d) => d.paperId === source.paperId)!;
          const block = doc.blocks.find((b) => b.id === source.blockId)!;
          const quote = exactQuote(block.text, source.quote);
          if (!quote) throw new ApiError('摘录无法唯一定位到原文，请重新提问。');
          const { originalIndex: _originalIndex, ...publicSource } = source as typeof source & { originalIndex?: number };
          return {
            ...publicSource,
            quote,
            reference: {
              paperId: doc.paperId,
              documentHash: doc.documentHash,
              parseHash: doc.parseHash,
              parseVersionId: doc.parseVersionId,
              blockId: block.id,
              page: block.page,
              quote,
              rect: block.rect,
              width: block.width,
              height: block.height,
            },
          };
        });
        try {
          result.savedAnswerId = await saveAnswer(owner, id, {
            ...(observationIds.length ? { observationIds } : {}),
            question,
            mode: body.mode === 'excerpts' ? 'excerpts' : 'analysis',
            model: body.mode === 'excerpts' ? null : aiStatus().model,
            projectRevision: p.revision,
            contextHash: await sha256(JSON.stringify(context)),
            contextSnapshot: context,
            inputs: documents.map((d) => ({
              paperId: d.paperId,
              documentHash: d.documentHash,
              parseHash: d.parseHash,
              parseVersionId: d.parseVersionId,
            })),
            result,
          });
        } catch {
          result.persistenceError =
            '回答已生成，但历史保存失败，请先复制本次内容。';
        }
        return json(result);
      };
      if (body.mode === 'excerpts') {
        const sources = documents.flatMap((d) =>
          selectReadingBlocks(d.blocks, question, 6000)
            .slice(0, 3)
            .map((b) => ({
              paperId: d.paperId,
              paperTitle: d.title,
              blockId: b.id,
              page: b.page,
              quote: b.text,
            })),
        );
        return finish({
          answer: sources.length
            ? '以下为检索到的原文摘录，未作结论推断。'
            : '在已提供材料中未找到片段，不能据此断言论文未报告。',
          sources,
          statements: [],
          unverified: false,
          context: {
            title: p.title,
            question: p.question,
            feedbackCount: context.readingFeedback.length,
            noteCount: context.notes.length,
          },
          coverage: documents.map((d) => ({
            paperId: d.paperId,
            title: d.title,
            mode: d.coverage,
            includedBlocks: d.blocks.length,
            totalBlocks: d.totalBlocks,
            parsing: d.parsing,
          })),
        });
      }
      const rawHistory = Array.isArray(body.history)
        ? body.history.slice(-6)
        : [];
      const history = rawHistory.map((h: unknown) => {
        const turn =
          h && typeof h === 'object' ? (h as Record<string, unknown>) : {};
        return {
          question:
            typeof turn.question === 'string'
              ? turn.question.slice(0, 3000)
              : '',
          answer:
            typeof turn.answer === 'string' ? turn.answer.slice(0, 7000) : '',
        };
      });
      const answer = await modelJSON(
        owner,
        id,
        'answer-v2',
        '你是围绕用户课题工作的科研阅读助手。project 中的 title 是课题名称，question 是研究目标，equipment/currentMethod/constraints 是用户条件，未填写时明确指出未知，不要说不知道已提供的课题。回答方法适用性时将论文证据与用户条件逐项对照，说明可用之处、资源或数据差距、与已读文献相比的新增信息。参考 project.readingFeedback 中已尝试(tried)、不适用(unsuitable)、留待验证(verify)及原因，避免重复建议已被否定的做法；用户记录和历史回答不是论文事实，涉及它们时明确说明来自用户记录。跨文献比较必须标明每篇文献名及其证据，不能把不同实验条件的数据混为一谈。documents.coverage 为 excerpts 表示只检索了部分片段，不能声称阅读完整全文；没有依据就说明不足。history 用于理解追问，事实仍须核对本次 documents。返回 {"answer":"中文回答","sources":[{"paperId":"文献编号","blockId":"该文献的原文块编号","quote":"原文连续摘录"}]}。来源只能引用本次提供的 documents，不能编造或错配文献。',
        {
          question,
          project: context,
          documents,
          history,
          requiredOutput:
            'PDF 只提供已提取文字，coverage=parsed 不代表图像/表格/公式完整，incomplete 表示存在解析问题；先说明 parsing 中的缺页和质量警告，不能把未提取到的信息断言为论文未报告。JSON中还必须包含statements数组，每项{text:单个主张,kind:fact或calculation或inference或unknown,sourceIndices:[sources数组中从0开始的索引],observationIndices:[project.experimentObservations数组中从0开始的索引]}。实验观察是用户记录，涉及其数据时明确说明“用户实验观察”，标注observationIndices，不伪装成文献来源。若观察含calculation，只能在其记录的输入、方向、前提、校正方案和适用条件下复述保存的数值；服务器复算仅验证算术与输入血缘，不证实用户声明的前提，不把未拒绝原假设解释为等效，不证明因果或独立复现。不把人工判断当作证实，不推导未提供的统计显著性。不得把观察的数字填入论文sources。拆分一句中多个主张。没有证据用unknown，最多24项。answer用于概述，但每个实际主张都必须在statements中。',
        },
        answerSchema,
      );
      const valid = answer.sources.flatMap((s, originalIndex) => {
        const doc = documents.find((d) => d.paperId === s.paperId);
        const block = doc?.blocks.find((b) => b.id === s.blockId);
        if (!doc || !block || s.quote.trim().length < 3) return [];
        return [
          {
            ...s,
            // A model may normalize PDF line breaks. A referenced block is an
            // exact, auditable fallback; semantic support is checked below.
            quote: exactQuote(block.text, s.quote) ?? block.text,
            originalIndex,
            paperTitle: doc.title,
            page: block.page,
          },
        ];
      });
      const checks = answer.statements.length
        ? await modelJSON(
            owner,
            id,
            'answer-support-v1',
            '逐项检查主张是否由其来源支持。检查使用/必须、相关/因果、部分/全部、训练/测试、单位、统计显著性和检索缺失。用户条件与偏好不作为论文证据；综合推断标为部分支持或无法判断；未经可复算验证的计算不标为支持。仅返回JSON {"checks":[{"index":0,"support":"supported|partial|conflict|unknown","reason":"具体原因"}]}。',
            {
              statements: answer.statements,
              sources: answer.sources,
              experimentObservations: context.experimentObservations ?? [],
              observationPolicy:
                '用户实验观察不是论文事实或独立验证。含calculation时，算术与输入血缘已经服务器复算，但统计前提、比较族完整性、因果解释和独立复现未经证实；判断支持程度时必须保留这些限制。仅凭人工判断或单次数据不能判为统计显著或证明假设。',
            },
            supportSchema,
          )
        : { checks: [] };
      const statements = answer.statements.map((s, index) => {
        const validRefs = s.sourceIndices
          .map((i) => valid.find((v) => v.originalIndex === i))
          .filter((ref) => !!ref);
        const check = checks.checks.filter((c) => c.index === index);
        const observationRefs = validateObservationIndices(
          s.observationIndices,
          observations.length,
        );
        const located =
          validRefs.length + observationRefs.indices.length > 0 &&
          validRefs.length === s.sourceIndices.length &&
          observationRefs.valid;
        return {
          ...s,
          kind:
            observationRefs.indices.length && s.kind === 'fact'
              ? ('inference' as const)
              : s.kind,
          observationIndices: observationRefs.indices,
          sourceIndices: validRefs.map((ref) => valid.findIndex((v) => v.originalIndex === ref.originalIndex)),
          support:
            located && check.length === 1
              ? qualifiedSupport(
                  s.kind,
                  check[0].support,
                  observationRefs.indices.length > 0,
                )
              : 'unknown',
          reason:
            located && check.length === 1
              ? s.kind === 'unknown'
                ? '该主张类型为未知，需补充依据，不能确认为支持。'
                : (observationRefs.indices.length
                    ? '含用户实验观察，未作独立验证。'
                    : s.kind === 'calculation' || s.kind === 'inference'
                      ? '未完成独立复算或验证。'
                      : '') + check[0].reason
              : '缺少有效来源，无法判断。',
          needsReview: true,
        };
      });
      return finish({
        ...answer,
        answer: statements.length
          ? statements
              .map(
                (s) =>
                  `${{ fact: '原文事实', calculation: '计算结果（需复算）', inference: '综合推断', unknown: '未知' }[s.kind]} · ${{ supported: '依据支持', partial: '部分支持', conflict: '冲突', unknown: '无法判断' }[s.support]}：${s.text}`,
              )
              .join('\n\n')
          : '无法判断：模型没有返回可逐项核对的主张。请改用原文摘录或重新提问。',
        statements,
        sources: valid,
        context: {
          title: p.title,
          question: p.question,
          profile: p.state.profile ?? {},
          feedbackCount: context.readingFeedback.length,
          noteCount: context.notes.length,
        },
        coverage: documents.map((d) => ({
          paperId: d.paperId,
          title: d.title,
          mode: d.coverage,
          includedBlocks: d.blocks.length,
          totalBlocks: d.totalBlocks,
          parsing: d.parsing,
        })),
        unverified:
          !statements.length ||
          statements.some(
            (s) => s.support !== 'supported' || s.kind !== 'fact',
          ),
      });
    }
    if (body.task === 'review') {
      ensureRevision(p, body.revision);
      const r = p.state.review;
      if (!r.newText.trim() || !r.feedback.trim())
        throw new ApiError('请先保存新稿和修改意见。');
      if (r.items.some((i) => i.status === 'done'))
        throw new ApiError('已有人工确认的意见，请先保存新版本再重新分析。');
      const result = await modelJSON(
        owner,
        id,
        'review-v1',
        '分析修改意见与新旧段落。每条事项只引用新稿中存在的连续原文；缺乏修改证据则 evidence 为空。新增文字不能证明补充实验已经完成。status 只能 open（未处理）、partial（部分）、review（待作者核对）。返回 {"items":[{"instruction":"修改事项","evidence":"新稿原文","explanation":"判断依据","status":"open"}]}。',
        { oldText: r.oldText, newText: r.newText, feedback: r.feedback },
        reviewSchema,
      );
      r.items = result.items.map((i) => {
        const valid = !i.evidence || r.newText.includes(i.evidence);
        return {
          ...i,
          id: uid(),
          evidence: valid ? i.evidence : '',
          status: valid ? i.status : 'open',
          explanation: valid
            ? i.explanation
            : '模型引用的修改证据未通过校验，请人工核对。',
          confirmation: '',
        };
      });
      logActivity(p.state, 'AI 分析修改意见，等待作者核对。');
      return json(await saveProject(p, owner, p.revision));
    }
    throw new ApiError('未知的 AI 任务。');
  } catch (e) {
    return failure(e);
  }
}
