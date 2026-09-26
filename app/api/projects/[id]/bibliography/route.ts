import { z } from 'zod';
import {
  ownerOf,
  mutationGuard,
  json,
  failure,
  readBody,
  getProject,
  ensureRevision,
  saveProject,
  bindings,
  fileKey,
  ApiError,
} from '@/lib/server';
import {
  parseBibliography,
  checkBibliographyDuplicates,
} from '@/lib/bibliography';
import { sha256 } from '@/lib/graph';
import { ensureCells, logActivity, type Block } from '@/lib/domain';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const inputSchema = z.object({
  action: z.enum(['preview', 'import']),
  format: z.enum(['bibtex', 'ris', 'endnote']),
  filename: z.string().trim().min(1).max(200),
  text: z.string().min(1),
  revision: z.number().int().positive(),
  hash: z.string().optional(),
  selected: z.array(z.number().int().nonnegative()).max(20).optional(),
});
export async function GET(req: Request, ctx: Context) {
  try {
    const owner = await ownerOf(req),
      { id } = await ctx.params,
      p = await getProject(id, owner);
    const record = p.state.bibliographyImports?.find(
      (r) => r.id === new URL(req.url).searchParams.get('id'),
    );
    if (!record) throw new ApiError('导入记录不存在。', 404);
    const raw = await bindings().FILES.get(
      fileKey(owner, id, record.id, 'bibliography'),
    );
    if (!raw) throw new ApiError('原始书目文件不存在。', 404);
    return new Response(raw.body, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(record.filename)}`,
      },
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request, ctx: Context) {
  try {
    mutationGuard(req);
    const owner = await ownerOf(req),
      { id } = await ctx.params,
      body = inputSchema.parse(await readBody(req, 3000000)),
      p = await getProject(id, owner);
    ensureRevision(p, body.revision);
    const hash = await sha256(body.text),
      entries = checkBibliographyDuplicates(
        parseBibliography(body.text, body.format, body.filename),
        p.state.papers,
      );
    if (body.action === 'preview')
      return json({ hash, revision: p.revision, entries });
    if (body.hash !== hash)
      throw new ApiError('文件在预览后已变化，请重新预览。', 409);
    const selected = body.selected ?? [];
    if (!selected.length || new Set(selected).size !== selected.length)
      throw new ApiError('请选择1至20条不同的书目。');
    if (p.state.papers.length + selected.length > 20)
      throw new ApiError('导入后超过每课题20篇上限，请缩小选择范围。');
    const chosen = selected.map((i) => entries[i]);
    if (chosen.some((e) => !e || e.error || e.duplicate))
      throw new ApiError('所选条目无效或 DOI 重复，本批未导入。');
    if ((p.state.bibliographyImports?.length ?? 0) >= 50)
      throw new ApiError('本课题导入记录已达50批，请新建课题。');
    const batchId = crypto.randomUUID(),
      at = new Date().toISOString(),
      keys: string[] = [],
      paperIds: string[] = [];
    try {
      const sourceKey = fileKey(owner, id, batchId, 'bibliography');
      keys.push(sourceKey);
      await bindings().FILES.put(sourceKey, body.text);
      for (const entry of chosen) {
        const work = {
            ...entry.work,
            importedFrom: {
              filename: body.filename,
              hash,
              entry: entry.index + 1,
            },
          },
          paperId = crypto.randomUUID();
        const text =
          work.abstract ||
          `${work.title}\n${work.doi ? `DOI: ${work.doi}\n` : ''}仅有书目元数据，没有摘要或全文。`;
        const blocks: Block[] = Array.from(
          { length: Math.ceil(text.length / 5000) },
          (_, i) => ({
            id: `${paperId}:b${i}`,
            page: 1,
            text: text.slice(i * 5000, (i + 1) * 5000),
          }),
        );
        const rawKey = fileKey(owner, id, paperId, 'raw'),
          blocksKey = fileKey(owner, id, paperId, 'blocks.json');
        keys.push(rawKey, blocksKey);
        await bindings().FILES.put(rawKey, text);
        await bindings().FILES.put(blocksKey, JSON.stringify(blocks));
        p.state.papers.push({
          id: paperId,
          title: work.title,
          filename: `${work.title.slice(0, 80)}-${work.abstract ? '摘要' : '书目'}.txt`,
          kind: 'text',
          pages: 1,
          hash: await sha256(text),
          sample: false,
          blockCount: blocks.length,
          importedAt: at,
          metadata: work,
          coverage: work.abstract ? 'abstract' : 'metadata',
        });
        paperIds.push(paperId);
      }
      (p.state.bibliographyImports ??= []).push({
        id: batchId,
        filename: body.filename,
        format: body.format,
        hash,
        at,
        paperIds,
        entries: selected.map((i) => i + 1),
      });
      ensureCells(p.state);
      logActivity(
        p.state,
        `导入 ${body.filename} 中 ${chosen.length} 条书目；保留原始文件，未获取全文。`,
      );
      return json({ project: await saveProject(p, owner, p.revision) }, 201);
    } catch (e) {
      // A transport failure can occur after commit. Never delete files from an uncertain committed batch.
      const latest = await getProject(id, owner);
      if (latest.state.bibliographyImports?.some((r) => r.id === batchId))
        return json({ project: latest }, 201);
      await bindings().FILES.delete(keys);
      throw e;
    }
  } catch (e) {
    return failure(e);
  }
}
