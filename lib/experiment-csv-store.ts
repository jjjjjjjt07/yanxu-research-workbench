import { bindings, fileKey, ApiError } from './server';
import { sha256 } from './graph';
import type { CsvSource } from './experiment-csv';

export function csvFileKey(owner: string, projectId: string, sourceId: string) {
  return fileKey(owner, projectId, sourceId, 'experiment-csv');
}
export async function readCsvSource(
  owner: string,
  projectId: string,
  source: CsvSource,
) {
  const file = await bindings().FILES.get(
    csvFileKey(owner, projectId, source.id),
  );
  if (!file)
    throw new ApiError('CSV来源文件缺失，请保留现有记录并检查存储。', 503);
  const bytes = await file.arrayBuffer();
  if (
    bytes.byteLength !== source.size ||
    (await sha256(bytes)) !== source.sha256
  )
    throw new ApiError('CSV来源文件校验失败，本次未提供下载。', 503);
  return bytes;
}
