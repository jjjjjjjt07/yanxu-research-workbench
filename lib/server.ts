import { env } from 'cloudflare:workers';
import { readGuestSession, sessionCookie } from './guest-session';
import { invalidateObservationCitations } from './observation-citations';
import { now, type Project, type ProjectState, type Block } from './domain';
import { LIMITS } from './limits.ts';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export function bindings() {
  return env as unknown as {
    DB: D1Database;
    FILES: R2Bucket;
    AI_API_KEY?: string;
    AI_BASE_URL?: string;
    AI_MODEL?: string;
    AI_DAILY_CALL_LIMIT?: string;
    JOB_RUNNER_SECRET?: string;
    PUBLIC_ACCESS?: string;
    GUEST_SESSION_SECRET?: string;
    AI_PUBLIC_DAILY_LIMIT?: string;
  };
}
export async function ownerOf(req: Request) {
  if (bindings().PUBLIC_ACCESS === '1') {
    const guest = await readGuestSession(sessionCookie(req), bindings().GUEST_SESSION_SECRET ?? '');
    if (!guest) throw new ApiError('访客会话已失效，请刷新页面。', 401);
    return guest;
  }
  const owner = req.headers.get('oai-authenticated-user-id');
  if (!owner) throw new ApiError('请先登录后使用科研工作台。', 401);
  return owner;
}
export function mutationGuard(req: Request) {
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin)
    throw new ApiError('请求来源不匹配。', 403);
}
export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}
export function failure(e: unknown) {
  return json(
    {
      error:
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : '操作未完成，请重试。',
    },
    e instanceof ApiError ? e.status : 400,
  );
}
export async function readBody(req: Request, max = 1_000_000) {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > max) throw new ApiError('请求内容过大。', 413);
  const text = await req.text();
  if (new TextEncoder().encode(text).length > max)
    throw new ApiError('请求内容过大。', 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('请求格式无效。');
  }
}
type Row = {
  id: string;
  owner: string;
  title: string;
  question: string;
  state: string;
  revision: number;
  created_at: string;
  updated_at: string;
};
export function projectFromRow(r: Row): Project {
  return {
    id: r.id,
    title: r.title,
    question: r.question,
    state: JSON.parse(r.state),
    revision: r.revision,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
export async function getProject(id: string, owner: string) {
  const row = await bindings()
    .DB.prepare('SELECT * FROM projects WHERE id = ? AND owner = ?')
    .bind(id, owner)
    .first<Row>();
  if (!row) throw new ApiError('课题不存在或没有访问权限。', 404);
  return projectFromRow(row);
}
export async function insertProject(project: Project, owner: string) {
  await bindings()
    .DB.prepare(
      'INSERT INTO projects (id,owner,title,question,state,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
    )
    .bind(
      project.id,
      owner,
      project.title,
      project.question,
      JSON.stringify(project.state),
      project.revision,
      project.createdAt,
      project.updatedAt,
    )
    .run();
}
export function prepareProjectSave(
  p: Project,
  owner: string,
  expected: number,
) {
  invalidateObservationCitations(p.state);
  const state = JSON.stringify(p.state);
  if (new TextEncoder().encode(state).length > LIMITS.stateBytes)
    throw new ApiError(
      '课题记录已达到容量上限，请新建课题继续。',
      413,
    );
  const at = now();
  const db = bindings().DB;
  const update = db
    .prepare(
      'UPDATE projects SET title=?, question=?, state=?, revision=revision+1, updated_at=? WHERE id=? AND owner=? AND revision=?',
    )
    .bind(p.title, p.question, state, at, p.id, owner, expected);
  return {
    project: { ...p, revision: expected + 1, updatedAt: at },
    statements: [
      db
        .prepare(
          'INSERT INTO projects SELECT * FROM projects WHERE id=? AND owner=? AND revision!=?',
        )
        .bind(p.id, owner, expected),
      update,
    ],
  };
}
export async function saveProject(
  p: Project,
  owner: string,
  expected: number,
  extra: D1PreparedStatement[] = [],
) {
  const prepared = prepareProjectSave(p, owner, expected);
  let r: D1Result;
  try {
    const results = await bindings().DB.batch([
      ...prepared.statements,
      ...extra,
    ]);
    r = results[1];
  } catch (e) {
    if (String(e).includes('UNIQUE constraint failed: graph_revisions'))
      throw new ApiError('图谱依据已更新，本次表格修改未保存，请刷新。', 409);
    if (String(e).includes('UNIQUE constraint failed: projects'))
      throw new ApiError('课题已更新，请刷新后重试。', 409);
    throw e;
  }
  if (!r.meta.changes)
    throw new ApiError(
      '课题已在其他操作中更新，请刷新后重试。你的操作尚未覆盖任何数据。',
      409,
    );
  return prepared.project;
}
export function fileKey(
  owner: string,
  projectId: string,
  paperId: string,
  ext: string,
) {
  return `${encodeURIComponent(owner)}/${projectId}/${paperId}.${ext}`;
}
/** 长文分段存储：第 index 段的键。 */
export function segmentKey(
  owner: string,
  projectId: string,
  paperId: string,
  index: number,
) {
  return fileKey(owner, projectId, paperId, `blocks/${String(index).padStart(3, '0')}.json`);
}
/** 长文分段存储：段清单的键。 */
export function segmentIndexKey(
  owner: string,
  projectId: string,
  paperId: string,
) {
  return fileKey(owner, projectId, paperId, 'blocks/index.json');
}
export async function getBlocks(
  owner: string,
  projectId: string,
  paperId: string,
): Promise<Block[]> {
  const project = await getProject(projectId, owner);
  const paper = project.state.papers.find((p) => p.id === paperId);
  if (!paper) throw new ApiError('文献不存在。', 404);
  const { parseFileSuffix } = await import('./parse-versions');
  const files = bindings().FILES;
  // 解析纠错/OCR 版本仍为单对象；仅原始解析在超长时按段存储。
  if (!paper.parseVersionId || paper.parseVersionId === 'original') {
    const segments = paper.blockSegments ?? 1;
    if (segments > 1) {
      const all: Block[] = [];
      for (let i = 0; i < segments; i++) {
        const part = await files.get(segmentKey(owner, projectId, paperId, i));
        if (!part) throw new ApiError('文献解析资料不完整，请重新导入。', 404);
        all.push(...(await part.json<Block[]>()));
      }
      return all;
    }
  }
  const obj = await files.get(
    fileKey(owner, projectId, paperId, parseFileSuffix(paper.parseVersionId)),
  );
  if (!obj) throw new ApiError('文献解析资料不存在。', 404);
  return obj.json<Block[]>();
}
export function ensureRevision(p: Project, revision: unknown) {
  if (revision !== p.revision)
    throw new ApiError('课题版本已经变化，请刷新后重试。', 409);
}
export function fieldRules(state: ProjectState, fieldId: string) {
  return state.rules.filter((r) => r.fieldId === fieldId);
}
