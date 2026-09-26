import {
  bindings,
  ownerOf,
  mutationGuard,
  json,
  failure,
  readBody,
  getProject,
  getBlocks,
  ApiError,
} from '@/lib/server';
import { aiStatus } from '@/lib/ai';
import { uid, now } from '@/lib/domain';
import { workerOnline } from '@/lib/graph-store';
import { researchContext } from '@/lib/research-context';
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
    if (!aiStatus().configured)
      throw new ApiError(
        '尚未连接 AI，无法自动提取。可以先手动核对演示数据或配置模型。',
        503,
      );
    if (!(await workerOnline()))
      throw new ApiError('后台执行器未连接，请启动后台服务后提交任务。', 503);
    const requested = Array.isArray(body.paperIds)
      ? body.paperIds
      : p.state.papers.map((x) => x.id);
    const papers = p.state.papers.filter((x) => requested.includes(x.id));
    const fieldIds = (
      Array.isArray(body.fieldIds)
        ? body.fieldIds
        : p.state.fields.map((f) => f.id)
    ).filter((id: string) => p.state.fields.some((f) => f.id === id));
    if (!papers.length || !fieldIds.length)
      throw new ApiError('请先添加文献和字段。');
    for (const paper of papers) {
      const blocks = await getBlocks(owner, id, paper.id);
      if (!blocks.some((b) => b.text.trim()))
        throw new ApiError(
          `「${paper.title}」没有可引用文字，请先在阅读页完成 OCR 核对或补充原文。`,
        );
    }
    const active = await bindings()
      .DB.prepare(
        "SELECT id FROM jobs WHERE project_id=? AND owner=? AND status IN ('queued','running') LIMIT 1",
      )
      .bind(id, owner)
      .first();
    if (active)
      throw new ApiError('当前课题还有提取任务，请先完成或取消任务。', 409);
    const created = [];
    for (const paper of papers) {
      const jobId = uid(),
        at = now();
      const snapshot = {
        paperHash: paper.hash,
        context: JSON.stringify(researchContext(p)),
        contextVersion: p.state.contextVersion ?? 0,
        fields: p.state.fields.filter((f) => fieldIds.includes(f.id)),
        rules: p.state.rules.filter((r) => fieldIds.includes(r.fieldId)),
      };
      await bindings()
        .DB.prepare(
          'INSERT INTO jobs (id,owner,project_id,paper_id,field_ids,status,snapshot,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          jobId,
          owner,
          id,
          paper.id,
          JSON.stringify(fieldIds),
          'queued',
          JSON.stringify(snapshot),
          at,
          at,
        )
        .run();
      created.push(jobId);
    }
    return json({ jobs: created }, 201);
  } catch (e) {
    return failure(e);
  }
}
