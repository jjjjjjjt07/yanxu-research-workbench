import { ownerOf, mutationGuard, bindings, getProject, json, failure, ApiError } from '@/lib/server';
import { executeNextGraphJob } from '@/lib/graph-jobs';
import { runExtractionJob } from '@/lib/extraction-job';
export const dynamic = 'force-dynamic';
export async function POST(req: Request, ctx: {params: Promise<{id: string}>}) {
  try {
    mutationGuard(req);
    if (bindings().PUBLIC_ACCESS !== '1') throw new ApiError('未开启云端访客执行。',404);
    const owner = await ownerOf(req), {id} = await ctx.params;
    await getProject(id,owner);
    const graph = await executeNextGraphJob({owner,projectId:id});
    if (!graph.idle) return json(graph);
    const job = await bindings().DB.prepare("SELECT id FROM jobs WHERE owner=? AND project_id=? AND attempts<3 AND (status='queued' OR (status='failed' AND updated_at<?) OR (status='running' AND updated_at<?)) ORDER BY created_at LIMIT 1")
      .bind(owner,id,new Date(Date.now()-30000).toISOString(),new Date(Date.now()-120000).toISOString()).first<{id:string}>();
    return job ? await runExtractionJob(owner,job.id,'run') : json({idle:true});
  } catch(e) { return failure(e); }
}
