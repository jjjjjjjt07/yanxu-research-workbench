import { z } from 'zod';
import {
  ownerOf,
  mutationGuard,
  json,
  failure,
  getProject,
  saveProject,
  ApiError,
} from '@/lib/server';
import { recordImportAttempt } from '@/lib/domain';
import { reasonCode } from '@/lib/imports';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  filename: z.string().min(1).max(200),
  bytes: z.number().int().min(0).max(2_000_000_000),
  reason: z.string().max(80).optional(),
  message: z.string().min(1).max(1000),
  at: z.string().max(40).optional(),
});

/**
 * 记录一次「未能进入服务端」的导入尝试。
 *
 * 客户端在解析阶段就会因文件过大 / 字符过多而中止，这类失败根本不会
 * 产生 /documents 请求，因此需要由客户端回报。写入课题状态后，刷新页面
 * 依然能看到某篇论文为什么没进来。
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    mutationGuard(req);
    const owner = await ownerOf(req);
    const { id } = await ctx.params;
    const parsed = bodySchema.parse(await req.json());
    const p = await getProject(id, owner);
    recordImportAttempt(p.state, {
      filename: parsed.filename,
      bytes: parsed.bytes,
      status: 'failed',
      stage: 'client',
      reason: parsed.reason ?? reasonCode(parsed.message),
      message: parsed.message,
      at: parsed.at,
    });
    // 回传最新项目，让页面能同步 revision，避免下一次上传被乐观并发拒绝。
    try {
      return json(await saveProject(p, owner, p.revision), 201);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const latest = await getProject(id, owner);
        recordImportAttempt(latest.state, {
          filename: parsed.filename,
          bytes: parsed.bytes,
          status: 'failed',
          stage: 'client',
          reason: parsed.reason ?? reasonCode(parsed.message),
          message: parsed.message,
          at: parsed.at,
        });
        return json(await saveProject(latest, owner, latest.revision), 201);
      }
      throw e;
    }
  } catch (e) {
    return failure(e);
  }
}
