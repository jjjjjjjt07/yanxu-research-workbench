import { bindings, json, failure, ApiError } from '@/lib/server';
import { executeNextGraphJob } from '@/lib/graph-jobs';
import { runExtractionJob } from '@/lib/extraction-job';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  try {
    const secret = bindings().JOB_RUNNER_SECRET;
    if (!secret || secret.length < 32)
      throw new ApiError('后台执行器密钥未配置。', 503);
    const expected = new TextEncoder().encode(`Bearer ${secret}`),
      actual = new TextEncoder().encode(req.headers.get('authorization') ?? '');
    // Hashes have constant length; do not expose the runner credential to the frontend.
    const a = new Uint8Array(await crypto.subtle.digest('SHA-256', actual)),
      b = new Uint8Array(await crypto.subtle.digest('SHA-256', expected));
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    if (diff) throw new ApiError('没有执行器权限。', 401);
    await bindings()
      .DB.prepare(
        "UPDATE jobs SET status='failed',error='最后一次执行中断且已达到重试上限，请人工重试。',updated_at=? WHERE status='running' AND attempts>=3 AND updated_at<?",
      )
      .bind(
        new Date().toISOString(),
        new Date(Date.now() - 120000).toISOString(),
      )
      .run();
    const graph = await executeNextGraphJob();
    if (!graph.idle) return json(graph);
    const job = await bindings()
      .DB.prepare(
        "SELECT id,owner FROM jobs WHERE attempts<3 AND (status='queued' OR (status='failed' AND updated_at<?) OR (status='running' AND updated_at<?)) ORDER BY created_at LIMIT 1",
      )
      .bind(
        new Date(Date.now() - 30000).toISOString(),
        new Date(Date.now() - 120000).toISOString(),
      )
      .first<{ id: string; owner: string }>();
    if (job) {
      const result = await runExtractionJob(job.owner, job.id, 'run');
      return json({ jobId: job.id, ...((await result.json()) as object) });
    }
    return json(graph);
  } catch (e) {
    return failure(e);
  }
}
