import type { ProjectState } from './domain';
import type { ObservationReference } from './observation-reference';
import { observationReferenceCurrent } from './observation-reference.ts';
import { makeManuscriptAnchor } from './manuscript-citations.ts';
export type ObservationCitationBinding = Awaited<
  ReturnType<typeof makeManuscriptAnchor>
> & { source: ObservationReference; actor: string; at: string; reason: string };
export type ObservationCitation = ObservationCitationBinding & {
  id: string;
  status: 'linked' | 'stale' | 'withdrawn';
  history: (ObservationCitationBinding & {
    status: ObservationCitation['status'];
  })[];
};
function snapshot(c: ObservationCitation) {
  const { id: _id, history: _history, ...rest } = c;
  return structuredClone(rest);
}
export function observationCitationStatus(
  state: ProjectState,
  c: ObservationCitation,
) {
  if (c.status !== 'linked') return c.status;
  return !observationReferenceCurrent(state, c.source) ||
    (state.review.versions?.at(-1)?.id ?? 'legacy') !== c.manuscriptVersionId ||
    state.review.newText.slice(c.start, c.end) !== c.text
    ? 'stale'
    : 'linked';
}
export function invalidateObservationCitations(state: ProjectState) {
  for (const c of state.review?.observationCitations ?? [])
    if (
      c.status === 'linked' &&
      observationCitationStatus(state, c) === 'stale'
    )
      c.status = 'stale';
}
export async function saveObservationCitation(
  state: ProjectState,
  source: ObservationReference,
  text: string,
  actor: string,
  reason: string,
  id?: string,
) {
  if (!reason.trim()) throw new Error('请填写引用核对说明。');
  const citations = state.review.observationCitations ?? [];
  const prior = citations.find((c) => c.id === id);
  if (id && !prior) throw new Error('实验观察引用不存在。');
  if (prior ? prior.history.length >= 100 : citations.length >= 100)
    throw new Error('引用或历史达到100条上限，已有内容未覆盖。');
  const value = {
    ...(await makeManuscriptAnchor(state.review, text)),
    source: structuredClone(source),
    actor,
    at: new Date().toISOString(),
    reason,
  };
  if (prior) {
    prior.history.push(snapshot(prior));
    Object.assign(prior, value, { status: 'linked' });
  } else
    citations.push({
      ...value,
      id: crypto.randomUUID(),
      status: 'linked',
      history: [],
    });
  state.review.observationCitations = citations;
}
export function withdrawObservationCitation(
  state: ProjectState,
  id: string,
  actor: string,
  reason: string,
) {
  const c = state.review.observationCitations?.find((c) => c.id === id);
  if (!c || c.status === 'withdrawn')
    throw new Error('没有可撤回的实验观察引用。');
  if (!reason.trim()) throw new Error('请填写撤回说明。');
  if (c.history.length >= 100)
    throw new Error('引用历史已达100条，已有内容未覆盖。');
  c.history.push(snapshot(c));
  Object.assign(c, {
    status: 'withdrawn',
    actor,
    reason,
    at: new Date().toISOString(),
  });
}
