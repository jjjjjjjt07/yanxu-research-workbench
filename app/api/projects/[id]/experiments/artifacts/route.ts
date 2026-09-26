import { z } from 'zod';
import {
  ApiError,
  bindings,
  ensureRevision,
  failure,
  getProject,
  json,
  mutationGuard,
  ownerOf,
  prepareProjectSave,
  readBody,
  saveProject,
} from '@/lib/server';
import {
  addExperimentArtifact,
  artifactKey,
  artifactKindSchema,
  decodeArtifact,
  recordIndependentReproduction,
  reproductionInputSchema,
} from '@/lib/experiment-artifacts';
import { invalidateExperimentObservations } from '@/lib/observations';
import { logActivity } from '@/lib/domain';
import { sha256 } from '@/lib/graph';

export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const uploadSchema = z
  .object({
    revision: z.number().int(),
    experimentId: z.string(),
    versionId: z.string(),
    kind: artifactKindSchema,
    filename: z.string().trim().min(1).max(180),
    note: z.string().trim().min(1).max(1200),
    base64: z.string().max(2_666_668),
  })
  .strict();
const verifySchema = z
  .object({
    revision: z.number().int(),
    experimentId: z.string(),
    versionId: z.string(),
  })
  .extend(reproductionInputSchema.shape)
  .strict();

export async function POST(req: Request, ctx: Context) {
  try {
    mutationGuard(req);
    const owner = await ownerOf(req);
    const { id } = await ctx.params;
    const input = uploadSchema.parse(await readBody(req, 2_800_000));
    const project = await getProject(id, owner);
    ensureRevision(project, input.revision);
    const experiment = project.state.experiments.find(
      (value) => value.id === input.experimentId,
    );
    if (!experiment) throw new ApiError('实验不存在。', 404);
    const bytes = decodeArtifact(input.base64);
    let artifact;
    try {
      artifact = await addExperimentArtifact(
        experiment,
        input.versionId,
        { ...input, bytes },
        owner,
      );
    } catch (cause) {
      throw new ApiError((cause as Error).message);
    }
    prepareProjectSave(project, owner, project.revision);
    await bindings().FILES.put(artifactKey(owner, id, artifact.id), bytes, {
      httpMetadata: { contentType: 'application/octet-stream' },
    });
    logActivity(project.state, `保存实验附件：${artifact.filename}`);
    return json(await saveProject(project, owner, project.revision), 201);
  } catch (cause) {
    return failure(cause);
  }
}

export async function PATCH(req: Request, ctx: Context) {
  try {
    mutationGuard(req);
    const owner = await ownerOf(req);
    const { id } = await ctx.params;
    const input = verifySchema.parse(await readBody(req));
    const project = await getProject(id, owner);
    ensureRevision(project, input.revision);
    const experiment = project.state.experiments.find(
      (value) => value.id === input.experimentId,
    );
    if (!experiment) throw new ApiError('实验不存在。', 404);
    try {
      const {
        revision: _revision,
        experimentId: _experimentId,
        versionId,
        ...details
      } = input;
      recordIndependentReproduction(experiment, versionId, details, owner);
    } catch (cause) {
      throw new ApiError((cause as Error).message);
    }
    invalidateExperimentObservations(project.state, experiment.id);
    logActivity(project.state, `记录独立复现核对：${input.reason}`);
    return json(await saveProject(project, owner, project.revision));
  } catch (cause) {
    return failure(cause);
  }
}

export async function GET(req: Request, ctx: Context) {
  try {
    const owner = await ownerOf(req);
    const { id } = await ctx.params;
    const project = await getProject(id, owner);
    const artifactId = new URL(req.url).searchParams.get('artifactId');
    const artifact = project.state.experiments
      .flatMap((experiment) => experiment.artifacts ?? [])
      .find((value) => value.id === artifactId);
    if (!artifact) throw new ApiError('实验附件不存在。', 404);
    const object = await bindings().FILES.get(
      artifactKey(owner, id, artifact.id),
    );
    if (!object) throw new ApiError('实验附件文件缺失。', 409);
    const bytes = await object.arrayBuffer();
    if (
      bytes.byteLength !== artifact.size ||
      (await sha256(bytes)) !== artifact.sha256
    )
      throw new ApiError('实验附件完整性校验失败。', 409);
    return new Response(bytes, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(artifact.filename)}`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Content-SHA256': artifact.sha256,
      },
    });
  } catch (cause) {
    return failure(cause);
  }
}
