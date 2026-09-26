import { bindings, getProject, ApiError, prepareProjectSave } from './server';
import { invalidateEvidenceLinks } from './evidence-links';
import { logActivity, type Project } from './domain';
import { emptyGraph, sha256, type Graph } from './graph';
import { invalidateGraphParses } from './parse-versions';
import { invalidateObservationGraph } from './observations';

export async function loadGraph(
  projectId: string,
  owner: string,
): Promise<Graph> {
  await getProject(projectId, owner);
  const row = await bindings()
    .DB.prepare(
      'SELECT data FROM graph_revisions WHERE project_id=? AND owner=? ORDER BY revision DESC LIMIT 1',
    )
    .bind(projectId, owner)
    .first<{ data: string }>();
  if (!row) return emptyGraph();
  const graph = JSON.parse(row.data) as Graph;
  // 旧快照没有后加的字段；读取时补齐，避免界面拿到 undefined。
  graph.isolated ??= [];
  return graph;
}
export async function saveGraph(
  projectId: string,
  owner: string,
  graph: Graph,
  expected: number,
  action: string,
  actor = owner,
  extra: D1PreparedStatement[] = [],
  linkedProject?: Project,
) {
  const project = linkedProject ?? (await getProject(projectId, owner));
  invalidateGraphParses(graph, project.state.papers);
  const g = { ...graph, revision: expected + 1 },
    data = JSON.stringify(g),
    db = bindings().DB;
  if (new TextEncoder().encode(data).length > 1_700_000)
    throw new ApiError('图谱达到当前容量，请拆分课题；已有历史未删除。', 413);
  const revision = db
    .prepare(
      'INSERT INTO graph_revisions (id,project_id,owner,revision,data,hash,action,actor,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    )
    .bind(
      crypto.randomUUID(),
      projectId,
      owner,
      g.revision,
      data,
      await sha256(data),
      action,
      actor,
      new Date().toISOString(),
    );
  const statements = [revision];
  for (const [table, rows] of [
    ['graph_entities', g.entities],
    ['graph_mentions', g.mentions],
    ['graph_evidence', g.evidence],
    ['graph_relations', g.relations],
  ] as const) {
    statements.push(
      db.prepare(`DELETE FROM ${table} WHERE project_id=?`).bind(projectId),
    );
    statements.push(
      table === 'graph_relations'
        ? db
            .prepare(
              `INSERT INTO ${table} (id,project_id,source,target,data) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.source'),json_extract(value,'$.target'),value FROM json_each(?)`,
            )
            .bind(projectId, JSON.stringify(rows))
        : db
            .prepare(
              `INSERT INTO ${table} (id,project_id,data) SELECT json_extract(value,'$.id'),?,value FROM json_each(?)`,
            )
            .bind(projectId, JSON.stringify(rows)),
    );
  }
  const affected =
    invalidateEvidenceLinks(project.state, g) +
    invalidateObservationGraph(project.state, g);
  if (affected)
    logActivity(
      project.state,
      `图谱来源变化：${affected} 项引用或实验观察待复查。`,
    );
  if (linkedProject || affected) {
    extra = [
      ...extra,
      ...prepareProjectSave(project, owner, project.revision).statements,
    ];
  } else {
    extra = [
      ...extra,
      bindings()
        .DB.prepare(
          'INSERT INTO projects SELECT * FROM projects WHERE id=? AND owner=? AND revision!=?',
        )
        .bind(projectId, owner, project.revision),
    ];
  }
  try {
    await db.batch([...statements, ...extra]);
  } catch (e) {
    if (String(e).includes('UNIQUE constraint failed: projects'))
      throw new ApiError(
        '课题已更新，本次图谱及关联记录均未保存，请刷新。',
        409,
      );
    if (String(e).includes('UNIQUE constraint failed: graph_revisions'))
      throw new ApiError(
        '图谱已更新，请刷新后重试；本次操作未覆盖任何数据。',
        409,
      );
    throw e;
  }
  return g;
}
export async function graphJobs(projectId: string, owner: string) {
  return (
    await bindings()
      .DB.prepare(
        'SELECT id,batch_id AS batchId,paper_id AS paperId,task,status,stage,error,error_kind AS errorKind,attempts,updated_at AS updatedAt,created_at AS createdAt FROM graph_jobs WHERE project_id=? AND owner=? ORDER BY created_at DESC LIMIT 100',
      )
      .bind(projectId, owner)
      .all()
  ).results;
}
export async function workerOnline() {
  if (bindings().PUBLIC_ACCESS === '1') return true;
  const row = await bindings()
    .DB.prepare('SELECT heartbeat FROM graph_workers WHERE id=?')
    .bind('executor')
    .first<{ heartbeat: string }>();
  return !!row && Date.now() - Date.parse(row.heartbeat) < 150000;
}
