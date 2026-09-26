import {
  bindings,
  ownerOf,
  mutationGuard,
  json,
  failure,
  readBody,
  projectFromRow,
  insertProject,
  fileKey,
  ApiError,
} from '@/lib/server';
import { emptyState, now, uid, type Project } from '@/lib/domain';
import { createSample } from '@/lib/sample';
import { aiStatus } from '@/lib/ai';
import { profileSchema } from '@/lib/actions';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  try {
    const owner = await ownerOf(req),
      db = bindings().DB;
    const { results } = await db
      .prepare('SELECT * FROM projects WHERE owner=? ORDER BY updated_at DESC')
      .bind(owner)
      .all();
    const calls = await db
      .prepare(
        'SELECT COUNT(*) as total, COALESCE(SUM(input_tokens),0) as inputTokens, COALESCE(SUM(output_tokens),0) as outputTokens FROM model_calls WHERE owner=? AND created_at>=?',
      )
      .bind(owner, now().slice(0, 10))
      .first();
    return json({
      projects: results.map((r) => {
        const p = projectFromRow(r as never);
        return {
          id: p.id,
          title: p.title,
          question: p.question,
          updatedAt: p.updatedAt,
          papers: p.state.papers.length,
        };
      }),
      ai: aiStatus(),
      guest: bindings().PUBLIC_ACCESS === '1',
      usage: calls,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    mutationGuard(req);
    const owner = await ownerOf(req),
      body = await readBody(req);
    const count = await bindings()
      .DB.prepare('SELECT COUNT(*) as n FROM projects WHERE owner=?')
      .bind(owner)
      .first<{ n: number }>();
    const limit = bindings().PUBLIC_ACCESS === '1' ? 3 : 100;
    if ((count?.n ?? 0) >= limit) throw new ApiError(`当前空间最多保存 ${limit} 个课题。`);
    const sample = body.sample === true;
    const title = sample
      ? '低算力图像识别 · 演示课题'
      : String(body.title ?? '').trim();
    if (!title || title.length > 100)
      throw new ApiError('请填写 1—100 字的课题名称。');
    const question = sample
      ? '比较轻量分类方法的实验条件与效果。此课题包含虚构样本，只用于功能演示。'
      : String(body.question ?? '').slice(0, 3000);
    const createdAt = now();
    const seeded = sample ? createSample() : null;
    const p: Project = {
      id: uid(),
      title,
      question,
      createdAt,
      updatedAt: createdAt,
      revision: 1,
      state: seeded?.state ?? emptyState(),
    };
    if (!sample && body.profile !== undefined) {
      const profile = profileSchema.safeParse(body.profile);
      if (!profile.success)
        throw new ApiError('课题条件格式错误或超出长度限制。');
      p.state.profile = profile.data;
    }
    if (seeded)
      for (const d of seeded.documents) {
        await bindings().FILES.put(
          fileKey(owner, p.id, d.paperId, 'blocks.json'),
          JSON.stringify(d.blocks),
        );
        await bindings().FILES.put(
          fileKey(owner, p.id, d.paperId, 'raw'),
          d.text,
          { httpMetadata: { contentType: 'text/plain; charset=utf-8' } },
        );
      }
    await insertProject(p, owner);
    return json(p, 201);
  } catch (e) {
    return failure(e);
  }
}
