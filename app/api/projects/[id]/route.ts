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
} from '@/lib/server';
import { act } from '@/lib/actions';
import { loadGraph } from '@/lib/graph-store';
import { invalidateEvidenceLinks } from '@/lib/evidence-links';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(req: Request, ctx: Context) {
  try {
    const owner = await ownerOf(req),
      { id } = await ctx.params,
      p = await getProject(id, owner);
    const { results } = await bindings()
      .DB.prepare(
        'SELECT id,project_id as projectId,paper_id as paperId,field_ids as fieldIds,status,error,created_at as createdAt,updated_at as updatedAt FROM jobs WHERE project_id=? AND owner=? ORDER BY created_at DESC LIMIT 40',
      )
      .bind(id, owner)
      .all();
    return json({
      project: p,
      jobs: results.map((j) => ({
        ...j,
        fieldIds: JSON.parse(j.fieldIds as string),
      })),
    });
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(req: Request, ctx: Context) {
  try {
    mutationGuard(req);
    const owner = await ownerOf(req),
      { id } = await ctx.params,
      body = await readBody(req),
      p = await getProject(id, owner);
    ensureRevision(p, body.revision);
    const graph = await loadGraph(id, owner);
    await act(p, owner, body);
    invalidateEvidenceLinks(p.state, graph);
    const graphGuard = bindings()
      .DB.prepare(
        'INSERT INTO graph_revisions SELECT * FROM graph_revisions WHERE project_id=? AND owner=? AND revision>?',
      )
      .bind(id, owner, graph.revision);
    return json(await saveProject(p, owner, p.revision, [graphGuard]));
  } catch (e) {
    return failure(e);
  }
}
