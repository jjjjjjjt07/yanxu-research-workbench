import {
  bindings,
  ownerOf,
  mutationGuard,
  json,
  failure,
  getProject,
  ApiError,
  fileKey,
} from '@/lib/server';
import { loadGraph } from '@/lib/graph-store';
import { sha256 } from '@/lib/graph';
import { answerPrefix } from '@/lib/answer-history';
import { readCsvSource } from '@/lib/experiment-csv-store';
import { encodeCsvBytes } from '@/lib/experiment-csv';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(req: Request, ctx: Context) {
  try {
    const owner = await ownerOf(req),
      { id } = await ctx.params;
    await getProject(id, owner);
    const exportId = new URL(req.url).searchParams.get('download');
    if (exportId) {
      const row = await bindings()
        .DB.prepare(
          'SELECT * FROM export_manifests WHERE id=? AND owner=? AND project_id=?',
        )
        .bind(exportId, owner, id)
        .first<{ key: string; filename: string; status: string }>();
      if (!row || row.status === 'failed')
        throw new ApiError('导出文件不存在或生成失败。', 404);
      const file = await bindings().FILES.get(row.key);
      if (!file) throw new ApiError('导出文件不可用，请重新生成。', 404);
      return new Response(file.body, {
        headers: {
          'Content-Type': 'application/json;charset=utf-8',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
          'Cache-Control': 'no-store',
        },
      });
    }
    return json(
      (
        await bindings()
          .DB.prepare(
            'SELECT id,filename,hash,size,revision,status,created_at AS createdAt FROM export_manifests WHERE project_id=? AND owner=? ORDER BY created_at DESC',
          )
          .bind(id, owner)
          .all()
      ).results,
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request, ctx: Context) {
  let exportId = '',
    owner = '',
    projectId = '';
  try {
    mutationGuard(req);
    owner = await ownerOf(req);
    projectId = (await ctx.params).id;
    const project = await getProject(projectId, owner),
      graph = await loadGraph(projectId, owner),
      db = bindings().DB;
    exportId = crypto.randomUUID();
    const createdAt = new Date().toISOString(),
      filename = `${project.title}-图谱研究记录-v${graph.revision}.json`,
      key = `${encodeURIComponent(owner)}/${projectId}/exports/${exportId}.json`;
    await db
      .prepare(
        'INSERT INTO export_manifests (id,owner,project_id,filename,key,hash,size,revision,status,created_at) VALUES (?,?,?,?,?,?,?, ?,?,?)',
      )
      .bind(
        exportId,
        owner,
        projectId,
        filename,
        key,
        '',
        0,
        graph.revision,
        'generating',
        createdAt,
      )
      .run();
    const history = (
      await db
        .prepare(
          'SELECT revision,hash,action,actor,created_at AS createdAt FROM graph_revisions WHERE project_id=? AND owner=? ORDER BY revision',
        )
        .bind(projectId, owner)
        .all()
    ).results;
    const runs = (
      await db
        .prepare(
          'SELECT * FROM analysis_runs WHERE project_id=? AND owner=? ORDER BY created_at',
        )
        .bind(projectId, owner)
        .all<{
          id: string;
          task: string;
          model: string;
          request_key: string;
          output_key: string | null;
          status: string;
          created_at: string;
        }>()
    ).results;
    const files: { name: string; sha256: string; content: unknown }[] = [];
    let bytes = 0;
    async function add(name: string, content: unknown) {
      const text = JSON.stringify(content);
      bytes += new TextEncoder().encode(text).length;
      if (bytes > 24_000_000)
        throw new ApiError('记录包超出当前24MB导出范围，请分课题导出。', 413);
      files.push({ name, sha256: await sha256(text), content });
    }
    await add('project.json', project);
    const csvIds = new Set<string>();
    for (const experiment of project.state.experiments) {
      for (const version of experiment.versions) {
        const source = version.csvSource;
        if (!source || csvIds.has(source.id)) continue;
        const original = await readCsvSource(owner, projectId, source);
        await add(`experiments/${source.id}.json`, {
          ...source,
          contentEncoding: 'base64',
          base64: encodeCsvBytes(new Uint8Array(original)),
        });
        csvIds.add(source.id);
      }
    }
    let answerCursor: string | undefined;
    do {
      const page = await bindings().FILES.list({
        prefix: answerPrefix(owner, projectId),
        limit: 10,
        ...(answerCursor ? { cursor: answerCursor } : {}),
      });
      for (const object of page.objects) {
        const record = await bindings().FILES.get(object.key);
        if (!record) throw new ApiError('问答历史读取失败，请重新导出。', 503);
        await add(
          'answers/' + object.key.split('/').at(-1),
          await record.json(),
        );
      }
      answerCursor = page.truncated ? page.cursor : undefined;
    } while (answerCursor);
    await add('graph.json', graph);
    await add('graph-audit.json', history);
    for (const record of project.state.bibliographyImports ?? []) {
      const original = await bindings().FILES.get(
        fileKey(owner, projectId, record.id, 'bibliography'),
      );
      if (!original)
        throw new ApiError(
          `原始书目文件缺失：${record.filename}，本次记录包未生成。`,
        );
      const text = await original.text();
      if ((await sha256(text)) !== record.hash)
        throw new ApiError('原始书目文件哈希不匹配，本次记录包未生成。');
      await add(`bibliography/${record.id}.json`, { ...record, text });
    }
    for (const run of runs) {
      const input = await bindings().FILES.get(run.request_key),
        output = run.output_key
          ? await bindings().FILES.get(run.output_key)
          : null;
      await add(`runs/${run.id}.json`, {
        id: run.id,
        task: run.task,
        model: run.model,
        status: run.status,
        createdAt: run.created_at,
        input: input ? await input.json() : null,
        output: output ? await output.json() : null,
      });
    }
    const content = JSON.stringify({
      manifest: {
        format: 'research-graph-bundle/1',
        createdAt,
        projectId,
        projectRevision: project.revision,
        graphRevision: graph.revision,
        scope:
          '当前课题快照、图谱实体与证据、图谱审核事件、原始导入书目文本、已留存的实验CSV字节与行位置、已记录模型实际输入输出。不包含PDF原件、旧图谱快照及旧版未留存的CSV和模型输入输出。',
        hashAlgorithm: 'SHA-256 of JSON.stringify(content) in UTF-8',
        files: files.map(({ name, sha256 }) => ({ name, sha256 })),
      },
      files,
    });
    const hash = await sha256(content),
      size = new TextEncoder().encode(content).length;
    await bindings().FILES.put(key, content, {
      httpMetadata: { contentType: 'application/json' },
    });
    await db
      .prepare(
        "UPDATE export_manifests SET hash=?,size=?,status='generated' WHERE id=?",
      )
      .bind(hash, size, exportId)
      .run();
    return json(
      {
        id: exportId,
        filename,
        hash,
        size,
        revision: graph.revision,
        status: 'generated',
        createdAt,
      },
      201,
    );
  } catch (e) {
    if (exportId)
      await bindings()
        .DB.prepare(
          "UPDATE export_manifests SET status='failed' WHERE id=? AND owner=? AND project_id=?",
        )
        .bind(exportId, owner, projectId)
        .run();
    return failure(e);
  }
}
