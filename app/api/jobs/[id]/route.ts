import {
  ownerOf,
  mutationGuard,
  readBody,
  failure,
  bindings,
  json,
  ApiError,
} from '@/lib/server';
import { runExtractionJob } from '@/lib/extraction-job';
export const dynamic = 'force-dynamic';
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    mutationGuard(req);
    const owner = await ownerOf(req),
      { id } = await ctx.params,
      body = await readBody(req);
    if (body.action === 'run') {
      const db = bindings().DB,
        job = await db
          .prepare('SELECT status FROM jobs WHERE id=? AND owner=?')
          .bind(id, owner)
          .first<{ status: string }>();
      if (!job) throw new ApiError('任务不存在。', 404);
      if (job.status === 'cancelled')
        throw new ApiError('任务已取消，请新建任务。');
      if (job.status === 'failed')
        await db
          .prepare(
            "UPDATE jobs SET status='queued',attempts=0,updated_at=? WHERE id=? AND owner=? AND status='failed'",
          )
          .bind(new Date().toISOString(), id, owner)
          .run();
      return json({ status: job.status === 'failed' ? 'queued' : job.status });
    }
    return await runExtractionJob(owner, id, body.action);
  } catch (e) {
    return failure(e);
  }
}
