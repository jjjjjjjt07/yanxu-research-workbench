import type { DataRow, Experiment, ProjectState } from './domain';
import type { Graph, Bridge, Evidence, Entity, Relation } from './graph';
import { sha256 } from './graph.ts';
import {
  csvSourceSummary,
  csvRowReference,
  type CsvSource,
} from './experiment-csv.ts';

export type BridgeSnapshot = {
  bridge: Bridge;
  evidence: Evidence[];
  entities: Entity[];
  relations: Relation[];
};
export type ObservationSnapshot = {
  calculation?: import('./calculation-reference').CalculationReference;
  text: string;
  conditions: string;
  outcome: 'supports' | 'contradicts' | 'inconclusive';
  experiment: {
    reproducibility?: import('./experiment-reproducibility').ReproducibilityRecord;
    scope?: import('./experiment-scope').ExperimentScopeRecord;
    artifacts?: import('./experiment-artifacts').ExperimentArtifact[];
    reproductions?: import('./experiment-artifacts').IndependentReproduction[];
    csvSource?: Omit<CsvSource, 'lineRanges'>;
    id: string;
    name: string;
    versionId: string;
    filename: string;
    dataHash: string;
    direction: Experiment['direction'];
    rows: {
      index: number;
      value: DataRow;
      sourceRow?: ReturnType<typeof csvRowReference>;
    }[];
  };
  hypothesis?: { graphRevision: number; snapshot: BridgeSnapshot };
  actor: string;
  at: string;
  reason: string;
};
export type Observation = ObservationSnapshot & {
  revision?: number;
  id: string;
  status: 'recorded' | 'stale' | 'withdrawn';
  history: (ObservationSnapshot & { status: Observation['status'] })[];
};

export function bridgeSnapshot(graph: Graph, id: string): BridgeSnapshot {
  const bridge = graph.bridges.find((b) => b.id === id);
  if (!bridge) throw new Error('桥接假设不存在。');
  const evidence = bridge.evidenceIds.map((id) =>
    graph.evidence.find((e) => e.id === id),
  );
  const entities = [bridge.source, bridge.target].map((id) =>
    graph.entities.find((e) => e.id === id),
  );
  const relations = bridge.relationIds.map((id) =>
    graph.relations.find((r) => r.id === id),
  );
  if (
    evidence.some((e) => !e) ||
    entities.some((e) => !e) ||
    relations.some((r) => !r)
  )
    throw new Error('假设的来源或关系不完整，请先核对图谱。');
  return structuredClone({
    bridge,
    evidence: evidence as Evidence[],
    entities: entities as Entity[],
    relations: relations as Relation[],
  });
}

export async function captureExperiment(
  experiment: Experiment,
  versionId: string,
  indices: number[],
  rowLimit: 20 | 2000 = 20,
) {
  const version = experiment.versions.at(-1);
  if (!version || version.id !== versionId)
    throw new Error('实验版本已变化，请重新选择当前数据。');
  if (
    !indices.length ||
    indices.length > rowLimit ||
    new Set(indices).size !== indices.length ||
    indices.some(
      (i) => !Number.isInteger(i) || i < 0 || i >= version.rows.length,
    )
  )
    throw new Error(`请选择1—${rowLimit}条不同的有效数据行。`);
  return {
    id: experiment.id,
    name: experiment.name,
    versionId,
    filename: version.filename,
    direction: experiment.direction,
    dataHash: await sha256(JSON.stringify(version.rows)),
    rows: indices
      .toSorted((a, b) => a - b)
      .map((index) => ({
        index,
        value: structuredClone(version.rows[index]),
        ...(version.csvSource
          ? { sourceRow: csvRowReference(version.csvSource, index) }
          : {}),
      })),
    ...(version.csvSource
      ? { csvSource: csvSourceSummary(version.csvSource) }
      : {}),
    ...(version.reproducibility
      ? { reproducibility: structuredClone(version.reproducibility) }
      : {}),
    ...(version.scope ? { scope: structuredClone(version.scope) } : {}),
    ...(experiment.artifacts?.some(
      (artifact) => artifact.versionId === versionId,
    )
      ? {
          artifacts: structuredClone(
            experiment.artifacts.filter(
              (artifact) => artifact.versionId === versionId,
            ),
          ),
        }
      : {}),
    ...(experiment.reproductions?.some(
      (record) => record.versionId === versionId,
    )
      ? {
          reproductions: structuredClone(
            experiment.reproductions.filter(
              (record) => record.versionId === versionId,
            ),
          ),
        }
      : {}),
  };
}

export function saveObservation(
  state: ProjectState,
  value: ObservationSnapshot,
  id?: string,
) {
  if (!value.text.trim() || !value.conditions.trim() || !value.reason.trim())
    throw new Error('请填写观察、适用条件和核对说明。');
  const observations = state.observations ?? [];
  const index = observations.findIndex((o) => o.id === id),
    prior = observations[index];
  if (id && !prior) throw new Error('观察记录不存在。');
  if (!prior && observations.length >= 100)
    throw new Error('观察记录已达100条，已有内容未覆盖。');
  if (prior && prior.history.length >= 100)
    throw new Error('观察历史已达100条，已有内容未覆盖。');
  const history = prior ? [...prior.history, observationSnapshot(prior)] : [];
  const next: Observation = {
    ...structuredClone(value),
    id: prior?.id ?? crypto.randomUUID(),
    revision: prior ? (prior.revision ?? 1) + 1 : 1,
    status: 'recorded',
    history,
  };
  if (index < 0) observations.push(next);
  else observations[index] = next;
  state.observations = observations;
  return next;
}
function observationSnapshot(o: Observation) {
  const { id: _id, history: _history, ...snapshot } = o;
  return structuredClone(snapshot);
}
export function withdrawObservation(
  state: ProjectState,
  id: string,
  actor: string,
  at: string,
  reason: string,
) {
  const observation = state.observations?.find((o) => o.id === id);
  if (!observation || observation.status === 'withdrawn')
    throw new Error('没有可撤回的观察记录。');
  if (!reason.trim()) throw new Error('请填写撤回说明。');
  if (observation.history.length >= 100)
    throw new Error('观察历史已达100条，已有内容未覆盖。');
  observation.history.push(observationSnapshot(observation));
  Object.assign(observation, { status: 'withdrawn', actor, at, reason });
}

export function observationGraphMatches(
  state: ProjectState,
  graph: Graph,
  observation: Observation,
) {
  if (!observation.hypothesis) return true;
  const snapshot = observation.hypothesis.snapshot;
  try {
    if (
      JSON.stringify(snapshot) !==
      JSON.stringify(bridgeSnapshot(graph, snapshot.bridge.id))
    )
      return false;
  } catch {
    return false;
  }
  return snapshot.evidence.every((e) => {
    const paper = state.papers.find((p) => p.id === e.paperId);
    return (
      paper &&
      paper.hash === e.documentHash &&
      (!paper.parsing || paper.parsing.hash === e.parseHash)
    );
  });
}
export function invalidateObservationGraph(state: ProjectState, graph: Graph) {
  let changed = 0;
  for (const o of state.observations ?? [])
    if (o.status === 'recorded' && !observationGraphMatches(state, graph, o)) {
      o.status = 'stale';
      changed++;
    }
  return changed;
}
export function invalidateExperimentObservations(
  state: ProjectState,
  experimentId: string,
) {
  for (const o of state.observations ?? [])
    if (o.experiment.id === experimentId && o.status === 'recorded')
      o.status = 'stale';
}
