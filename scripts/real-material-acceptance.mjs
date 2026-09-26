import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const projectReportPath = 'outputs/v2-validation/graph-live.json';
const flowReportPath = 'outputs/v2-validation/v2-live-flows.json';
const outputPath = 'outputs/v2-validation/real-material-final-acceptance.json';
const archivedProjectPath =
  'outputs/v2-validation/real-paper-v41-acceptance-archive/project-row.json';
const requiredPaperCount = 20;
const requiredExperimentCount = 1;

assert.ok(
  existsSync(projectReportPath),
  'Missing current real-paper graph report.',
);
assert.ok(
  existsSync(flowReportPath),
  'Missing current real-paper flow report.',
);

const graphRun = JSON.parse(readFileSync(projectReportPath, 'utf8'));
const flowRun = JSON.parse(readFileSync(flowReportPath, 'utf8'));
assert.equal(graphRun.model, 'deepseek-flash');
assert.equal(flowRun.model, 'deepseek-flash');
assert.equal(graphRun.projectId, flowRun.projectId);

const databaseDirectory = '.wrangler/state/v3/d1/miniflare-D1DatabaseObject';
const databaseName = readdirSync(databaseDirectory).find(
  (name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite',
);
assert.ok(databaseName, 'Local D1 database was not found.');
const database = new DatabaseSync(join(databaseDirectory, databaseName), {
  readOnly: true,
});

let projectRow = database
  .prepare('SELECT * FROM projects WHERE id=?')
  .get(graphRun.projectId);
let projectRowSource = 'active';
if (!projectRow && existsSync(archivedProjectPath)) {
  projectRow = JSON.parse(readFileSync(archivedProjectPath, 'utf8')).row;
  projectRowSource = 'archived';
}
assert.ok(projectRow, 'Acceptance project was not found.');
const project = JSON.parse(projectRow.state);

const readGraphTable = (table) =>
  database
    .prepare(`SELECT data FROM ${table} WHERE project_id=?`)
    .all(graphRun.projectId)
    .map((row) => JSON.parse(row.data));

const entities = readGraphTable('graph_entities');
const mentions = readGraphTable('graph_mentions');
const evidence = readGraphTable('graph_evidence');
const relations = readGraphTable('graph_relations');
const latestRevisionRow = database
  .prepare(
    'SELECT data, revision, hash FROM graph_revisions WHERE project_id=? ORDER BY revision DESC LIMIT 1',
  )
  .get(graphRun.projectId);
assert.ok(latestRevisionRow, 'Graph revision was not found.');
const graph = JSON.parse(latestRevisionRow.data);

const graphJobs = database
  .prepare('SELECT * FROM graph_jobs WHERE project_id=? ORDER BY created_at')
  .all(graphRun.projectId);
const analysisRuns = database
  .prepare('SELECT * FROM analysis_runs WHERE project_id=? ORDER BY created_at')
  .all(graphRun.projectId);

const papersById = new Map(project.papers.map((paper) => [paper.id, paper]));
const entitiesById = new Map(entities.map((entity) => [entity.id, entity]));
const evidenceById = new Map(evidence.map((item) => [item.id, item]));
const relationsById = new Map(
  relations.map((relation) => [relation.id, relation]),
);
const normalize = (value) =>
  value.normalize('NFKC').replaceAll(/\s+/g, ' ').trim().toLowerCase();

const quoteChecks = evidence.map((item) => {
  const paper = papersById.get(item.paperId);
  const abstract = paper?.metadata?.abstract || '';
  return {
    evidenceId: item.id,
    paperId: item.paperId,
    paperExists: Boolean(paper),
    documentHashMatches: paper?.hash === item.documentHash,
    quoteFound: normalize(abstract).includes(normalize(item.quote)),
  };
});

const mentionChecks = mentions.map((mention) => {
  const entity = entitiesById.get(mention.entityId);
  const source = evidenceById.get(mention.evidenceId);
  return {
    mentionId: mention.id,
    entityExists: Boolean(entity),
    evidenceExists: Boolean(source),
    surfaceFound: source
      ? normalize(source.quote).includes(normalize(mention.surface))
      : false,
  };
});

const relationChecks = relations.map((relation) => ({
  relationId: relation.id,
  sourceExists: entitiesById.has(relation.source),
  targetExists: entitiesById.has(relation.target),
  evidenceComplete:
    relation.evidenceIds.length > 0 &&
    relation.evidenceIds.every((id) => evidenceById.has(id)),
  reviewStateRecorded: Boolean(relation.status && relation.support),
}));

const bridgeChecks = graph.bridges.map((bridge) => {
  const paperIds = new Set(
    bridge.evidenceIds
      .map((id) => evidenceById.get(id)?.paperId)
      .filter(Boolean),
  );
  return {
    bridgeId: bridge.id,
    endpointsExist:
      entitiesById.has(bridge.source) && entitiesById.has(bridge.target),
    relationsExist: bridge.relationIds.every((id) => relationsById.has(id)),
    evidenceComplete: bridge.evidenceIds.every((id) => evidenceById.has(id)),
    distinctPaperCount: paperIds.size,
    twoSidedEvidence: paperIds.size >= 2,
    limitationsRecorded: Boolean(bridge.differences && bridge.risks),
    experimentRecorded: Boolean(bridge.experiment),
    humanDecisionRequired: bridge.status === 'explore',
  };
});

const uniqueDois = [
  ...new Set(
    project.papers
      .map((paper) => paper.metadata?.doi?.trim().toLowerCase())
      .filter(Boolean),
  ),
];
const fullTextPapers = project.papers.filter(
  (paper) => paper.coverage !== 'abstract',
);
const experiments = project.experiments || [];
const currentModelRuns = analysisRuns.filter(
  (run) => run.model === 'deepseek-flash' && run.status === 'succeeded',
);
const extractionJobs = graphJobs.filter((job) => job.task === 'extract');
const partialJobs = extractionJobs.filter((job) => job.status === 'partial');
const failedJobs = graphJobs.filter((job) => job.status === 'failed');

const deterministicChecks = {
  everyEvidenceQuoteLocated: quoteChecks.every(
    (check) =>
      check.paperExists && check.documentHashMatches && check.quoteFound,
  ),
  everyMentionLocated: mentionChecks.every(
    (check) => check.entityExists && check.evidenceExists && check.surfaceFound,
  ),
  everyRelationLinked: relationChecks.every(
    (check) =>
      check.sourceExists &&
      check.targetExists &&
      check.evidenceComplete &&
      check.reviewStateRecorded,
  ),
  everyBridgeTwoSided: bridgeChecks.every(
    (check) =>
      check.endpointsExist &&
      check.relationsExist &&
      check.evidenceComplete &&
      check.twoSidedEvidence &&
      check.limitationsRecorded &&
      check.experimentRecorded &&
      check.humanDecisionRequired,
  ),
  allJobsTerminal: graphJobs.every((job) =>
    ['succeeded', 'partial', 'failed', 'cancelled'].includes(job.status),
  ),
  noFailedJobs: failedJobs.length === 0,
  currentModelRecorded: currentModelRuns.length > 0,
  flowChecksPassed:
    flowRun.hypotheses > 0 &&
    flowRun.statements > 0 &&
    flowRun.checks.length === 7,
};

assert.ok(
  Object.values(deterministicChecks).every(Boolean),
  `Real-material deterministic check failed: ${JSON.stringify(deterministicChecks)}`,
);

const materialGate = {
  requiredUniquePapers: requiredPaperCount,
  availableUniquePapers: uniqueDois.length,
  requiredFullTexts: requiredPaperCount,
  availableFullTexts: fullTextPapers.length,
  requiredRealExperiments: requiredExperimentCount,
  availableRealExperiments: experiments.length,
  humanGoldStandardAvailable: false,
  researcherEfficiencyStudyAvailable: false,
};
const finalGatePassed =
  materialGate.availableUniquePapers >= materialGate.requiredUniquePapers &&
  materialGate.availableFullTexts >= materialGate.requiredFullTexts &&
  materialGate.availableRealExperiments >=
    materialGate.requiredRealExperiments &&
  materialGate.humanGoldStandardAvailable &&
  materialGate.researcherEfficiencyStudyAvailable;

const report = {
  verifiedAt: new Date().toISOString(),
  status: finalGatePassed ? 'passed' : 'insufficient_real_materials',
  project: {
    id: graphRun.projectId,
    title: projectRow.title,
    revision: projectRow.revision,
    rowSource: projectRowSource,
    model: 'deepseek-flash',
    sources: project.papers.map((paper) => ({
      title: paper.title,
      doi: paper.metadata?.doi || null,
      coverage: paper.coverage || 'unknown',
    })),
  },
  observed: {
    entities: entities.length,
    mentions: mentions.length,
    evidence: evidence.length,
    relations: relations.length,
    bridges: graph.bridges.length,
    answerStatements: flowRun.statements,
    currentModelRuns: currentModelRuns.length,
    extractionJobs: extractionJobs.map((job) => ({
      id: job.id,
      status: job.status,
      result: job.result ? JSON.parse(job.result) : null,
    })),
    partialExtractionJobs: partialJobs.length,
  },
  deterministicChecks,
  materialGate,
  limitations: [
    'Both available real papers are abstracts, not full text.',
    'No real experiment dataset is present in the acceptance project.',
    'No researcher-authored gold standard or efficiency comparison was supplied.',
    'A partial extraction is terminal and retains rejected candidate counts; it is not reported as full success.',
  ],
  integrity: {
    graphRevision: latestRevisionRow.revision,
    graphRevisionHash: latestRevisionRow.hash,
    payloadSha256: null,
  },
};
const reportWithoutHash = JSON.stringify(report, null, 2);
report.integrity.payloadSha256 = createHash('sha256')
  .update(reportWithoutHash)
  .digest('hex');
writeFileSync(outputPath, JSON.stringify(report, null, 2));
database.close();

console.log(
  JSON.stringify({
    status: report.status,
    observed: report.observed,
    deterministicChecks,
    materialGate,
    outputPath,
  }),
);
