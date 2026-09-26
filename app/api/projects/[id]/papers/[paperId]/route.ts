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

function requestedRange(value: string | null, size: number) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size === 0) return false;
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if (
    (first !== null && !Number.isSafeInteger(first)) ||
    (last !== null && !Number.isSafeInteger(last))
  ) return false;
  const start = first === null ? Math.max(0, size - last!) : first;
  const end = first === null ? size - 1 : Math.min(last ?? size - 1, size - 1);
  if (start >= size || end < start) return false;
  return { start, end };
}

async function paperResponse(
  req: Request,
  ctx: { params: Promise<{ id: string; paperId: string }> },
  headOnly: boolean,
) {
  try {
    const owner = await ownerOf(req),
      { id, paperId } = await ctx.params,
      p = await getProject(id, owner),
      paper = p.state.papers.find((x) => x.id === paperId);
    if (!paper) throw new ApiError('文献不存在。', 404);
    if (new URL(req.url).searchParams.get('raw') === '1') {
      const bucket = bindings().FILES;
      const key = fileKey(owner, id, paperId, 'raw');
      const object = await bucket.head(key);
      if (!object) throw new ApiError('原始文件不存在。', 404);
      const headers = new Headers({
        'Content-Type': paper.kind === 'pdf' ? 'application/pdf' : 'text/plain; charset=utf-8',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(paper.filename)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Accept-Ranges': 'bytes',
      });
      const range = requestedRange(req.headers.get('range'), object.size);
      if (range === false) {
        headers.set('Content-Range', `bytes */${object.size}`);
        headers.set('Content-Length', '0');
        return new Response(null, { status: 416, headers });
      }
      if (range) {
        const length = range.end - range.start + 1;
        headers.set('Content-Range', `bytes ${range.start}-${range.end}/${object.size}`);
        headers.set('Content-Length', String(length));
        if (headOnly) return new Response(null, { status: 206, headers });
        const file = await bucket.get(key, { range: { offset: range.start, length } });
        if (!file) throw new ApiError('原始文件不存在。', 404);
        return new Response(file.body, { status: 206, headers });
      }
      headers.set('Content-Length', String(object.size));
      if (headOnly) return new Response(null, { headers });
      const file = await bucket.get(key);
      if (!file) throw new ApiError('原始文件不存在。', 404);
      return new Response(file.body, { headers });
    }
    if (headOnly) return new Response(null, { status: 405 });
    return json({ paper, blocks: await getBlocks(owner, id, paperId) });
  } catch (e) {
    return failure(e);
  }
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; paperId: string }> },
) {
  return paperResponse(req, ctx, false);
}

export async function HEAD(
  req: Request,
  ctx: { params: Promise<{ id: string; paperId: string }> },
) {
  return paperResponse(req, ctx, true);
}
