import { z } from 'zod';
import {
  bindings,
  ownerOf,
  mutationGuard,
  json,
  failure,
  getProject,
  ensureRevision,
  saveProject,
  fileKey,
  segmentKey,
  segmentIndexKey,
  ApiError,
} from '@/lib/server';
import {
  uid,
  now,
  logActivity,
  ensureCells,
  recordImportAttempt,
  type Block,
} from '@/lib/domain';
import { LIMITS, FILE_MB } from '@/lib/limits';
import { reasonCode, splitBlocks } from '@/lib/imports';
import { pageQuality, type PageHint } from '@/lib/pdf-layout';
export const dynamic = 'force-dynamic';
const blocksSchema = z
  .array(
    z.object({
      id: z.string(),
      page: z.number().int().min(1).max(LIMITS.maxPages),
      text: z.string().max(LIMITS.blockChars),
      rect: z.array(z.number()).length(4).optional(),
      width: z.number().positive().optional(),
      height: z.number().positive().optional(),
    }),
  )
  .min(0)
  .max(LIMITS.maxBlocks);
const hintSchema = z
  .object({
    page: z.number().int().min(1).max(LIMITS.maxPages),
    layout: z.enum(['single', 'two-column']),
    rotated: z.boolean(),
  })
  .strict();
const parsingSchema = z
  .object({
    engine: z.enum(['pdfjs-layout-v2', 'pdfjs-layout-v3', 'plain-text-v1']),
    pages: z.array(hintSchema).max(LIMITS.maxPages),
  })
  .strict();

/** 分段存储的切分逻辑见 lib/imports.ts 的 splitBlocks。 */

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  let owner = '';
  let projectId = '';
  let filename = '';
  let bytes = 0;
  const stage = 'server' as const;
  try {
    mutationGuard(req);
    owner = await ownerOf(req);
    projectId = (await ctx.params).id;
    const p = await getProject(projectId, owner);
    if (Number(req.headers.get('content-length') || 0) > LIMITS.requestBytes)
      throw new ApiError(
        `请求过大，请使用 ${FILE_MB} MB 以下的文献。`,
        413,
      );
    const form = await req.formData();
    const file = form.get('file');
    const nameEntry = form.get('filename');
    const declaredName = file instanceof File ? file.name : typeof nameEntry === 'string' ? nameEntry : '';
    if (declaredName) filename = declaredName.slice(0, 160);
    if (file instanceof File) bytes = file.size;
    ensureRevision(p, Number(form.get('revision')));
    if (p.state.papers.length >= LIMITS.papersPerProject)
      throw new ApiError(
        `每个课题最多 ${LIMITS.papersPerProject} 篇文献。`,
      );
    if (!(file instanceof File) || file.size > LIMITS.fileBytes)
      throw new ApiError(`请选择 ${FILE_MB} MB 以下的 PDF 或 TXT 文件。`);
    const isPDF = file.name.toLowerCase().endsWith('.pdf'),
      isTXT = file.name.toLowerCase().endsWith('.txt');
    if (!isPDF && !isTXT) throw new ApiError('只支持 PDF 和 TXT 文件。');
    const fileBytes = await file.arrayBuffer();
    if (
      isPDF &&
      !new TextDecoder().decode(fileBytes.slice(0, 5)).startsWith('%PDF-')
    )
      throw new ApiError('文件不是有效 PDF。');
    const blocksEntry = form.get('blocks');
    const raw = typeof blocksEntry === 'string' ? blocksEntry : '';
    if (raw.length > LIMITS.blocksPayloadBytes) throw new ApiError('解析内容过大。');
    let parsed;
    try {
      parsed = blocksSchema.parse(JSON.parse(raw));
    } catch {
      throw new ApiError('解析数据无效，请重新选择文件。');
    }
    const totalChars = parsed.reduce((n, b) => n + b.text.length, 0);
    if (totalChars > LIMITS.maxTotalChars)
      throw new ApiError(
        `解析文本超过 ${LIMITS.maxTotalChars.toLocaleString('en-US')} 字符，请拆分文档。`,
      );
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', fileBytes)),
    )
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    if (p.state.papers.some((x) => x.hash === hash))
      throw new ApiError('这篇文献已经在当前课题中。');
    const paperId = uid();
    const blocks: Block[] = parsed
      .filter((b) => b.text.trim())
      .map((b, i) => ({ ...b, id: `${paperId}:b${i}` }));
    if (!blocks.length && (!isPDF || !form.has('parsing')))
      throw new ApiError(
        '未提取到文字。扫描 PDF 请通过新版上传入口导入后逐页OCR。',
      );
    const pageCount = Number(
      form.get('pageCount') || Math.max(...blocks.map((b) => b.page)),
    );
    if (
      !Number.isInteger(pageCount) ||
      pageCount < 1 ||
      pageCount < Math.max(...blocks.map((b) => b.page)) ||
      pageCount > LIMITS.maxPages
    )
      throw new ApiError('文献页数无效。');
    const kind = isPDF ? ('pdf' as const) : ('text' as const);
    let engine = 'legacy-client',
      hints: PageHint[] = [];
    if (form.has('parsing')) {
      try {
        const parsingEntry = form.get('parsing');
        if (typeof parsingEntry !== 'string') throw new Error();
        const rawReport = parsingEntry;
        if (rawReport.length > LIMITS.parsingReportBytes) throw new Error();
        const report = parsingSchema.parse(JSON.parse(rawReport));
        // v3 修好了标题页/图表页的分栏检测；v2 仍接受，便于对比旧解析。
        const engines = isPDF
          ? ['pdfjs-layout-v2', 'pdfjs-layout-v3']
          : ['plain-text-v1'];
        if (
          !engines.includes(report.engine) ||
          report.pages.length !== pageCount ||
          report.pages.some((h, i) => h.page !== i + 1)
        )
          throw new Error();
        engine = report.engine;
        hints = report.pages;
      } catch {
        throw new ApiError('解析质量报告无效，请重新选择文件。');
      }
    }
    const parseHash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(JSON.stringify(blocks)),
        ),
      ),
    )
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const parsing = {
      engine,
      hash: parseHash,
      pages: pageQuality(blocks, pageCount, hints),
    };
    // 分段存储：单段以内沿用旧键以保持兼容，超过则写成多段对象。
    const segments = splitBlocks(blocks);
    const storedKeys = [
      fileKey(owner, projectId, paperId, 'raw'),
      ...(segments.length > 1
        ? [
            segmentIndexKey(owner, projectId, paperId),
            ...segments.map((_, i) => segmentKey(owner, projectId, paperId, i)),
          ]
        : [fileKey(owner, projectId, paperId, 'blocks.json')]),
    ];
    try {
      await bindings().FILES.put(
        fileKey(owner, projectId, paperId, 'raw'),
        fileBytes,
        {
          httpMetadata: {
            contentType: isPDF ? 'application/pdf' : 'text/plain; charset=utf-8',
          },
        },
      );
      if (segments.length > 1) {
        for (let i = 0; i < segments.length; i++)
          await bindings().FILES.put(
            segmentKey(owner, projectId, paperId, i),
            JSON.stringify(segments[i]),
          );
        await bindings().FILES.put(
          segmentIndexKey(owner, projectId, paperId),
          JSON.stringify({
            segments: segments.length,
            blocks: blocks.length,
            chars: totalChars,
          }),
        );
      } else {
        await bindings().FILES.put(
          fileKey(owner, projectId, paperId, 'blocks.json'),
          JSON.stringify(blocks),
        );
      }
      p.state.papers.push({
        id: paperId,
        title: filename.replace(/\.[^.]+$/, ''),
        filename,
        pages: pageCount,
        hash,
        kind,
        sample: false,
        blockCount: blocks.length,
        blockSegments: segments.length > 1 ? segments.length : undefined,
        chars: totalChars,
        importedAt: now(),
        parsing,
      });
      recordImportAttempt(p.state, {
        filename,
        bytes,
        status: 'ok',
        stage,
        reason: 'imported',
        message: `已导入 ${pageCount} 页、${blocks.length} 个解析块、${totalChars} 字符。`,
        pages: pageCount,
        chars: totalChars,
        paperId,
      });
      logActivity(p.state, '导入文献：' + filename);
      ensureCells(p.state);
      return json(await saveProject(p, owner, p.revision), 201);
    } catch (e) {
      // A response may fail after commit: never delete files referenced by a committed paper.
      let latest;
      try {
        latest = await getProject(projectId, owner);
      } catch {
        throw e;
      }
      if (latest.state.papers.some((paper) => paper.id === paperId))
        return json(latest, 201);
      try {
        await bindings().FILES.delete(storedKeys);
      } catch (cleanupError) {
        console.error('Failed to clean up an uncommitted document upload', {
          projectId,
          paperId,
          cleanupError,
        });
      }
      throw e;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : '操作未完成，请重试。';
    // 失败原因要能在刷新后回看，因此尽力写入课题记录（失败不影响原始报错）。
    if (owner && projectId) {
      try {
        const latest = await getProject(projectId, owner);
        recordImportAttempt(latest.state, {
          filename: filename || '(未知文件)',
          bytes,
          status: 'failed',
          stage,
          reason: reasonCode(message),
          message,
        });
        await saveProject(latest, owner, latest.revision);
      } catch {
        /* 记录失败不覆盖原始错误 */
      }
    }
    return failure(e);
  }
}
