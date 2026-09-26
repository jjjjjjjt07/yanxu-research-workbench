import { z } from 'zod';
import {
  ownerOf,
  mutationGuard,
  json,
  failure,
  readBody,
  getProject,
  saveProject,
  bindings,
  fileKey,
  ApiError,
} from '@/lib/server';
import { searchCrossref } from '@/lib/scholar';
import { sha256 } from '@/lib/graph';
import { ensureCells, logActivity, type Block } from '@/lib/domain';
import { modelJSON } from '@/lib/ai';
export const dynamic = 'force-dynamic';
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    mutationGuard(req);
    const owner = await ownerOf(req),
      { id } = await ctx.params,
      body = await readBody(req),
      p = await getProject(id, owner);
    if (body.action === 'expand') {
      const query = z.string().trim().min(1).max(500).parse(body.query);
      return json(
        await modelJSON(
          owner,
          id,
          'search-query-v1',
          '把科研问题转换成可编辑的英文检索关键词，保留核心方法与研究约束，不声称已检索。返回 JSON {"query":"最多200字符关键词","explanation":"中文说明"}。',
          { question: query },
          z.object({
            query: z.string().max(200),
            explanation: z.string().max(800),
          }),
        ),
      );
    }
    if (body.action === 'search') {
      const query = z.string().trim().min(2).max(500).parse(body.query);
      if ((p.state.searches?.length ?? 0) >= 50)
        throw new ApiError('当前课题已记录50次检索，请新建课题。');
      const results = await searchCrossref(query),
        record = {
          id: crypto.randomUUID(),
          query,
          at: new Date().toISOString(),
          results,
        };
      (p.state.searches ??= []).push(record);
      logActivity(
        p.state,
        `Crossref 检索：${query}，返回 ${results.length} 条。`,
      );
      return json({ project: await saveProject(p, owner, p.revision), record });
    }
    if (body.action !== 'import') throw new ApiError('未知检索操作。');
    const work = p.state.searches
      ?.find((s) => s.id === body.searchId)
      ?.results.find((w) => w.doi === body.doi);
    if (!work) throw new ApiError('请选择已保存检索中的结果。');
    if (p.state.papers.some((p) => p.metadata?.doi === work.doi))
      throw new ApiError('这个 DOI 已在课题中，请核对已有文献。');
    if (p.state.papers.length >= 20)
      throw new ApiError('每个课题最多20篇文献。');
    const paperId = crypto.randomUUID(),
      text =
        work.abstract ||
        `${work.title}\nDOI: ${work.doi}\n仅有书目元数据，没有摘要或全文。`;
    const blocks: Block[] = Array.from(
      { length: Math.ceil(text.length / 5000) },
      (_, i) => ({
        id: `${paperId}:b${i}`,
        page: 1,
        text: text.slice(i * 5000, (i + 1) * 5000),
      }),
    );
    p.state.papers.push({
      id: paperId,
      title: work.title,
      filename: `${work.title.slice(0, 80)}-${work.abstract ? '摘要' : '书目'}.txt`,
      kind: 'text',
      pages: 1,
      hash: await sha256(text),
      sample: false,
      blockCount: blocks.length,
      importedAt: new Date().toISOString(),
      metadata: work,
      coverage: work.abstract ? 'abstract' : 'metadata',
    });
    await bindings().FILES.put(fileKey(owner, id, paperId, 'raw'), text);
    await bindings().FILES.put(
      fileKey(owner, id, paperId, 'blocks.json'),
      JSON.stringify(blocks),
    );
    ensureCells(p.state);
    logActivity(
      p.state,
      `导入 Crossref ${work.abstract ? '摘要' : '书目元数据'}：${work.title}。未获取全文。`,
    );
    try {
      return json({ project: await saveProject(p, owner, p.revision) });
    } catch (e) {
      await bindings().FILES.delete([
        fileKey(owner, id, paperId, 'raw'),
        fileKey(owner, id, paperId, 'blocks.json'),
      ]);
      throw e;
    }
  } catch (e) {
    return failure(e);
  }
}
