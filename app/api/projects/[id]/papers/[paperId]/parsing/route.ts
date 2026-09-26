import { z } from 'zod';
import {
  bindings,
  ownerOf,
  mutationGuard,
  json,
  failure,
  getProject,
  getBlocks,
  readBody,
  ensureRevision,
  fileKey,
  ApiError,
} from '@/lib/server';
import { logActivity } from '@/lib/domain';
import { loadGraph, saveGraph } from '@/lib/graph-store';
import { sha256 } from '@/lib/graph';
import { pageQuality } from '@/lib/pdf-layout';
import {
  correctBlock,
  invalidatePaperSources,
  parseFileSuffix,
  type ParseVersion,
} from '@/lib/parse-versions';
import type { Block } from '@/lib/domain';
import { replaceOcrPage, type OcrPreview } from '@/lib/ocr';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string; paperId: string }> };
async function material(req: Request, ctx: Context) {
  const owner = await ownerOf(req),
    { id, paperId } = await ctx.params,
    project = await getProject(id, owner);
  const paper = project.state.papers.find((p) => p.id === paperId);
  if (!paper) throw new ApiError('文献不存在。', 404);
  const blocks = await getBlocks(owner, id, paperId),
    hash = await sha256(JSON.stringify(blocks));
  if (paper.parsing && paper.parsing.hash !== hash)
    throw new ApiError('解析资料与当前版本不一致，请刷新或检查存储。', 409);
  const versions: ParseVersion[] = paper.parseVersions ?? [
    {
      id: 'original',
      hash,
      at: null,
      actor: null,
      reason: '原始解析基线；原解析时间和操作者未知',
      engine: paper.parsing?.engine ?? 'legacy-client',
      pages: pageQuality(blocks, paper.pages, paper.parsing?.pages),
    },
  ];
  return { owner, id, paperId, project, paper, blocks, hash, versions };
}
async function versionBlocks(
  m: Awaited<ReturnType<typeof material>>,
  versionId: string,
) {
  const version = m.versions.find((v) => v.id === versionId);
  if (!version) throw new ApiError('解析版本不存在。', 404);
  const file = await bindings().FILES.get(
    fileKey(m.owner, m.id, m.paperId, parseFileSuffix(version.id)),
  );
  if (!file) throw new ApiError('历史解析文件不存在，不能恢复。', 404);
  const blocks = await file.json<Block[]>();
  if ((await sha256(JSON.stringify(blocks))) !== version.hash)
    throw new ApiError('历史解析文件校验失败，不能恢复。', 409);
  return { version, blocks };
}
export async function GET(req: Request, ctx: Context) {
  try {
    const m = await material(req, ctx),
      selected = new URL(req.url).searchParams.get('version');
    const chosen = selected
      ? await versionBlocks(m, selected)
      : { version: m.versions.at(-1), blocks: m.blocks };
    return json({
      ...chosen,
      versions: m.versions,
      revision: m.project.revision,
      hash: m.hash,
      currentVersionId: m.paper.parseVersionId ?? 'original',
    });
  } catch (e) {
    return failure(e);
  }
}
export async function PATCH(req: Request, ctx: Context) {
  try {
    mutationGuard(req);
    const m = await material(req, ctx);
    const body = z
      .object({
        action: z.enum(['correct', 'restore', 'acceptOcr']),
        previewId: z.uuid().optional(),
        revision: z.number().int(),
        hash: z.string().length(64),
        blockId: z.string().optional(),
        text: z.string().min(1).max(6000).optional(),
        versionId: z.string().optional(),
        reason: z.string().trim().min(1).max(1200),
      })
      .parse(await readBody(req, 30000));
    ensureRevision(m.project, body.revision);
    if (body.hash !== m.hash)
      throw new ApiError('解析版本已变化，请刷新后重新核对。', 409);
    if (m.paper.metadata)
      throw new ApiError(
        '书目导入的摘要请通过文献来源核对，本入口仅纠正上传文件的解析文本。',
      );
    let next: Block[],
      restored: ParseVersion | undefined,
      ocr: OcrPreview | undefined;
    if (body.action === 'correct') {
      if (!body.blockId || body.text === undefined)
        throw new ApiError('请选择片段并填写修正文字。');
      try {
        next = correctBlock(m.blocks, body.blockId, body.text);
      } catch (e) {
        throw new ApiError(String((e as Error).message));
      }
    } else if (body.action === 'acceptOcr') {
      if (!body.previewId || m.paper.kind !== 'pdf')
        throw new ApiError('请选择本PDF的识别候选。');
      const object = await bindings().FILES.get(
        fileKey(m.owner, m.id, m.paperId, `ocr-${body.previewId}.json`),
      );
      if (!object) throw new ApiError('识别候选不存在。', 404);
      ocr = await object.json<OcrPreview>();
      if (
        ocr.paperId !== m.paperId ||
        ocr.documentHash !== m.paper.hash ||
        ocr.parseHash !== m.hash ||
        ocr.revision !== m.project.revision
      )
        throw new ApiError('识别候选对应旧文献或旧解析，请重新识别。', 409);
      try {
        next = replaceOcrPage(m.blocks, ocr);
      } catch (e) {
        throw new ApiError((e as Error).message);
      }
    } else {
      const chosen = await versionBlocks(m, body.versionId ?? '');
      next = chosen.blocks;
      restored = chosen.version;
    }
    const hash = await sha256(JSON.stringify(next));
    if (hash === m.hash) return json({ project: m.project, unchanged: true });
    if (m.versions.length >= 100)
      throw new ApiError('已达到每篇100个解析版本的容量，历史未删除。', 413);
    const graph = await loadGraph(m.id, m.owner),
      versionId = crypto.randomUUID(),
      at = new Date().toISOString();
    const version: ParseVersion = {
      id: versionId,
      hash,
      at,
      actor: m.owner,
      reason: body.reason,
      engine:
        restored?.engine ?? (ocr ? 'deepseek-vision-ocr-v1' : 'manual-text-v1'),
      ...(ocr
        ? {
            ocr: {
              previewId: ocr.id,
              model: ocr.model,
              imageHash: ocr.imageHash,
              page: ocr.page,
              warnings: ocr.warnings,
            },
          }
        : {}),
      pages: pageQuality(
        next,
        m.paper.pages,
        restored?.pages ?? m.paper.parsing?.pages,
      ),
      ...(restored ? { restoredFrom: restored.id } : {}),
    };
    m.paper.parseVersionId = versionId;
    m.paper.parseVersions = [...m.versions, version];
    m.paper.parsing = { engine: version.engine, hash, pages: version.pages };
    m.paper.blockCount = next.length;
    invalidatePaperSources(m.project.state, m.paperId);
    m.project.state.contextVersion = (m.project.state.contextVersion ?? 1) + 1;
    logActivity(
      m.project.state,
      `${body.action === 'restore' ? '恢复' : '纠正'}解析文本：${m.paper.title}；原因：${body.reason}。来源需复查，未完成的旧输入任务已取消。`,
    );
    const key = fileKey(m.owner, m.id, m.paperId, parseFileSuffix(versionId));
    try {
      await bindings().FILES.put(key, JSON.stringify(next));
      const db = bindings().DB;
      await saveGraph(
        m.id,
        m.owner,
        graph,
        graph.revision,
        '解析文本版本变化：依赖证据待复查',
        m.owner,
        [
          db
            .prepare(
              "UPDATE jobs SET status='cancelled',error=?,updated_at=? WHERE project_id=? AND owner=? AND status IN ('queued','running')",
            )
            .bind('解析文本已变化，请重新创建任务。', at, m.id, m.owner),
          db
            .prepare(
              "UPDATE graph_jobs SET status='cancelled',error=?,error_kind='stale_input',updated_at=? WHERE project_id=? AND owner=? AND status IN ('queued','running')",
            )
            .bind('解析文本已变化，请重新创建任务。', at, m.id, m.owner),
        ],
        m.project,
      );
      return json({ project: await getProject(m.id, m.owner), versionId });
    } catch (e) {
      let latest;
      try {
        latest = await getProject(m.id, m.owner);
      } catch {
        throw e;
      }
      if (
        latest.state.papers
          .find((p) => p.id === m.paperId)
          ?.parseVersions?.some((v) => v.id === versionId)
      )
        return json({ project: latest, versionId });
      await bindings().FILES.delete(key);
      throw e;
    }
  } catch (e) {
    return failure(e);
  }
}
