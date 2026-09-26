import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    title: text('title').notNull(),
    question: text('question').notNull(),
    state: text('state').notNull(),
    revision: integer('revision').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('idx_projects_owner').on(t.owner)],
);
export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    projectId: text('project_id').notNull(),
    paperId: text('paper_id').notNull(),
    fieldIds: text('field_ids').notNull(),
    status: text('status').notNull(),
    error: text('error'),
    snapshot: text('snapshot').notNull(),
    result: text('result'),
    attempts: integer('attempts').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    index('idx_jobs_project').on(t.projectId),
    index('idx_jobs_owner_status').on(t.owner, t.status),
  ],
);
export const calls = sqliteTable(
  'model_calls',
  {
    id: text('id').primaryKey(),
    owner: text('owner').notNull(),
    projectId: text('project_id').notNull(),
    task: text('task').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    duration: integer('duration').notNull(),
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('idx_calls_owner').on(t.owner)],
);

export const graphRevisions = sqliteTable(
  'graph_revisions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    owner: text('owner').notNull(),
    revision: integer('revision').notNull(),
    data: text('data').notNull(),
    hash: text('hash').notNull(),
    action: text('action').notNull(),
    actor: text('actor').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('graph_revision_unique').on(t.projectId, t.revision)],
);
export const graphEntities = sqliteTable(
  'graph_entities',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    data: text('data').notNull(),
  },
  (t) => [index('graph_entities_project').on(t.projectId)],
);
export const graphMentions = sqliteTable(
  'graph_mentions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    data: text('data').notNull(),
  },
  (t) => [index('graph_mentions_project').on(t.projectId)],
);
export const graphEvidence = sqliteTable(
  'graph_evidence',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    data: text('data').notNull(),
  },
  (t) => [index('graph_evidence_project').on(t.projectId)],
);
export const graphRelations = sqliteTable(
  'graph_relations',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    source: text('source').notNull(),
    target: text('target').notNull(),
    data: text('data').notNull(),
  },
  (t) => [
    index('graph_neighbors_source').on(t.projectId, t.source),
    index('graph_neighbors_target').on(t.projectId, t.target),
  ],
);
export const graphJobs = sqliteTable(
  'graph_jobs',
  {
    id: text('id').primaryKey(),
    batchId: text('batch_id').notNull(),
    owner: text('owner').notNull(),
    projectId: text('project_id').notNull(),
    paperId: text('paper_id').notNull(),
    task: text('task').notNull(),
    status: text('status').notNull(),
    stage: text('stage').notNull(),
    snapshot: text('snapshot').notNull(),
    result: text('result'),
    error: text('error'),
    errorKind: text('error_kind'),
    attempts: integer('attempts').notNull().default(0),
    lease: text('lease'),
    leaseUntil: text('lease_until'),
    nextAt: text('next_at').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [
    index('graph_jobs_queue').on(t.status, t.nextAt),
    index('graph_jobs_project').on(t.projectId, t.owner),
    uniqueIndex('graph_jobs_active_document')
      .on(t.projectId, t.paperId, t.task)
      .where(sql`${t.status} IN ('queued','running')`),
  ],
);
export const analysisRuns = sqliteTable('analysis_runs', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull(),
  projectId: text('project_id').notNull(),
  task: text('task').notNull(),
  model: text('model').notNull(),
  requestKey: text('request_key').notNull(),
  outputKey: text('output_key'),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
});
export const graphWorkers = sqliteTable('graph_workers', {
  id: text('id').primaryKey(),
  heartbeat: text('heartbeat').notNull(),
});
export const exportManifests = sqliteTable('export_manifests', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull(),
  projectId: text('project_id').notNull(),
  filename: text('filename').notNull(),
  key: text('key').notNull(),
  hash: text('hash').notNull(),
  size: integer('size').notNull(),
  revision: integer('revision').notNull(),
  status: text('status').notNull(),
  createdAt: text('created_at').notNull(),
});
