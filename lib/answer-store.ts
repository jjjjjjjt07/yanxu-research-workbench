import { bindings, ApiError } from './server';
import { answerPrefix, type AnswerRecord } from './answer-history';
export async function loadAnswer(owner: string, projectId: string, id: string) {
  if (!/^\d{13}-[0-9a-f-]{36}$/.test(id))
    throw new ApiError('问答记录标识无效。');
  const obj = await bindings().FILES.get(
    answerPrefix(owner, projectId) + id + '.json',
  );
  if (!obj) throw new ApiError('问答记录不存在。', 404);
  const record = await obj.json<AnswerRecord>();
  if (record.id !== id) throw new ApiError('问答记录标识不一致。', 409);
  return record;
}
export async function saveAnswer(
  owner: string,
  projectId: string,
  record: Omit<AnswerRecord, 'id' | 'at'>,
) {
  const id = `${String(9999999999999 - Date.now()).padStart(13, '0')}-${crypto.randomUUID()}`;
  const saved: AnswerRecord = { ...record, id, at: new Date().toISOString() };
  const content = JSON.stringify(saved);
  if (new TextEncoder().encode(content).length > 2_000_000)
    throw new Error('Answer snapshot exceeds limit');
  await bindings().FILES.put(
    answerPrefix(owner, projectId) + id + '.json',
    content,
    { httpMetadata: { contentType: 'application/json' } },
  );
  return id;
}
