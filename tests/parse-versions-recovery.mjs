import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const base = 'http://localhost:3000',
  headers = {
    cookie: '__sites_local_auth=1',
    'Content-Type': 'application/json',
    Connection: 'close',
  };
const { projectId } = JSON.parse(
  readFileSync('outputs/v2-validation/parse-versions-fixture-id.json', 'utf8'),
);
const path = '/api/projects/' + projectId;
let calls = 0;
async function api(url, body, status = 200) {
  const r = await fetch(base + url, {
    headers,
    ...(body ? { method: 'PATCH', body: JSON.stringify(body) } : {}),
  });
  const data = await r.json();
  calls++;
  assert.equal(r.status, status, JSON.stringify(data));
  return data;
}
let { project } = await api(path);
assert.equal(project.question, 'Synthetic parse version verification.');
const paper = project.state.papers[0],
  route = path + '/papers/' + paper.id + '/parsing';
let snapshot = await api(route);
const db = new DatabaseSync(
  '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite',
);
const row = db.prepare('SELECT * FROM projects WHERE id=?').get(project.id);
const job = randomUUID(),
  graphJob = randomUUID(),
  future = '2099-01-01T00:00:00.000Z';
// Future live leases prevent the worker from invoking any model for these synthetic tasks.
db.prepare(
  'INSERT INTO jobs (id,owner,project_id,paper_id,field_ids,status,snapshot,attempts,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
).run(
  job,
  row.owner,
  project.id,
  paper.id,
  '[]',
  'running',
  '{}',
  1,
  future,
  future,
);
db.prepare(
  'INSERT INTO graph_jobs (id,batch_id,owner,project_id,paper_id,task,status,stage,snapshot,attempts,lease,lease_until,next_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
).run(
  graphJob,
  randomUUID(),
  row.owner,
  project.id,
  paper.id,
  'extract',
  'running',
  'extracting',
  '{}',
  1,
  randomUUID(),
  future,
  future,
  future,
  future,
);
try {
  const result = await api(route, {
    action: 'correct',
    revision: project.revision,
    hash: snapshot.hash,
    blockId: snapshot.blocks[0].id,
    text: 'Synthetic cancellation verification ' + Date.now(),
    reason: 'Cancel stale-input fixtures atomically',
  });
  project = result.project;
  for (const [table, id] of [
    ['jobs', job],
    ['graph_jobs', graphJob],
  ])
    assert.equal(
      db.prepare(`SELECT status FROM ${table} WHERE id=?`).get(id).status,
      'cancelled',
    );
  snapshot = await api(route);
  const clean = JSON.stringify(project.state),
    tampered = structuredClone(project.state);
  tampered.papers[0].parseVersions[0].hash = '0'.repeat(64);
  db.prepare('UPDATE projects SET state=? WHERE id=? AND revision=?').run(
    JSON.stringify(tampered),
    project.id,
    project.revision,
  );
  try {
    await api(
      route,
      {
        action: 'restore',
        versionId: 'original',
        revision: project.revision,
        hash: snapshot.hash,
        reason: 'Reject corrupted history',
      },
      409,
    );
  } finally {
    db.prepare('UPDATE projects SET state=? WHERE id=? AND revision=?').run(
      clean,
      project.id,
      project.revision,
    );
  }
  assert.equal(
    db
      .prepare('SELECT COUNT(*) AS n FROM model_calls WHERE project_id=?')
      .get(project.id).n,
    0,
  );
  const report = {
    requestsPassed: calls,
    projectId: project.id,
    cancelledTasks: 2,
    historyHashMismatchRejected: true,
    modelCalls: 0,
  };
  writeFileSync(
    'outputs/v2-validation/parse-versions-recovery.json',
    JSON.stringify(report, null, 2),
  );
  console.log(report);
} finally {
  for (const [table, id] of [
    ['jobs', job],
    ['graph_jobs', graphJob],
  ])
    db.prepare(`UPDATE ${table} SET status='cancelled' WHERE id=?`).run(id);
  db.close();
}
