import {
  ownerOf,
  getProject,
  getBlocks,
  bindings,
  fileKey,
  json,
  failure,
  ApiError,
} from '@/lib/server';
export const dynamic = 'force-dynamic';
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; paperId: string }> },
) {
  try {
    const owner = await ownerOf(req),
      { id, paperId } = await ctx.params,
      p = await getProject(id, owner),
      paper = p.state.papers.find((x) => x.id === paperId);
    if (!paper) throw new ApiError('文献不存在。', 404);
    if (new URL(req.url).searchParams.get('raw') === '1') {
      const file = await bindings().FILES.get(
        fileKey(owner, id, paperId, 'raw'),
      );
      if (!file) throw new ApiError('原始文件不存在。', 404);
      return new Response(file.body, {
        headers: {
          'Content-Type':
            paper.kind === 'pdf'
              ? 'application/pdf'
              : 'text/plain; charset=utf-8',
          'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(paper.filename)}`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    return json({ paper, blocks: await getBlocks(owner, id, paperId) });
  } catch (e) {
    return failure(e);
  }
}
