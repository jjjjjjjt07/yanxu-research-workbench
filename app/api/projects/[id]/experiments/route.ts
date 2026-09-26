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
  prepareProjectSave,
  bindings,
  ApiError,
} from '@/lib/server';
import { act } from '@/lib/actions';
import { captureCsvSource, decodeCsvBytes } from '@/lib/experiment-csv';
import { csvFileKey, readCsvSource } from '@/lib/experiment-csv-store';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const input = z
  .object({
    revision: z.number().int(),
    id: z.string().optional(),
    name: z.string().trim().min(1).max(100),
    filename: z.string().trim().min(1).max(160),
    direction: z.enum(['higher', 'lower']),
    origin: z.enum(['file', 'text']),
    base64: z.string().max(1_333_336),
  })
  .strict();
export async function POST(req: Request, ctx: Context) {
  try {
    mutationGuard(req);
    const owner = await ownerOf(req),
      { id } = await ctx.params;
    const body = input.parse(await readBody(req, 1_400_000));
    const p = await getProject(id, owner);
    ensureRevision(p, body.revision);
    const bytes = decodeCsvBytes(body.base64);
    const { rows, source } = await captureCsvSource(
      bytes,
      body.filename,
      body.origin,
      owner,
    );
    await act(p, owner, {
      action: 'experiment.save',
      id: body.id,
      name: body.name,
      filename: body.filename,
      direction: body.direction,
      rows,
    });
    const experiment = body.id
      ? p.state.experiments.find((e) => e.id === body.id)!
      : p.state.experiments.at(-1)!;
    experiment.versions.at(-1)!.csvSource = source;
    // Validate project capacity before writing the immutable blob. If the DB commit
    // has an uncertain outcome, retain this unique blob rather than risk a broken reference.
    prepareProjectSave(p, owner, p.revision);
    await bindings().FILES.put(csvFileKey(owner, id, source.id), bytes, {
      httpMetadata: { contentType: 'text/csv;charset=utf-8' },
    });
    return json(await saveProject(p, owner, p.revision), 201);
  } catch (e) {
    return failure(e);
  }
}
export async function GET(req: Request, ctx: Context) {
  try {
    const owner = await ownerOf(req),
      { id } = await ctx.params,
      p = await getProject(id, owner);
    const url = new URL(req.url);
    const exp = p.state.experiments.find(
      (e) => e.id === url.searchParams.get('experimentId'),
    );
    const version = exp?.versions.find(
      (v) => v.id === url.searchParams.get('versionId'),
    );
    if (!version) throw new ApiError('实验数据版本不存在。', 404);
    if (!version.csvSource)
      throw new ApiError('此旧版本未留存CSV来源文件，仅有解析后的数据。', 404);
    const bytes = await readCsvSource(owner, id, version.csvSource);
    return new Response(bytes, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(version.csvSource.filename)}`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Content-SHA256': version.csvSource.sha256,
      },
    });
  } catch (e) {
    return failure(e);
  }
}
