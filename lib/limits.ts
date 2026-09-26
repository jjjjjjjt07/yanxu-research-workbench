/**
 * 集中式容量限制。
 *
 * 背景：早期版本把「单篇 15 MB / 80,000 解析字符」同时当成
 * 「上传上限」与「模型可处理上限」，导致 30–50 MB 的真实论文、
 * 以及 8 万字符以上的长文被整篇挡在门外，且没有任何部分导入。
 *
 * 现在的分工是：
 *  - 存储：按段保存全文，不截断（SEGMENT_CHARS 决定单段大小）。
 *  - 单次模型任务：只限制「送进这一次调用的内容量」，并把实际
 *    覆盖的页范围记录下来，绝不静默丢弃。
 *
 * 所有限制只在这里定义一次，客户端与服务端共用，避免再次出现
 * 「改了一处、另一处仍按旧值拒绝」的问题。
 */
export const LIMITS = {
  /** 单个原始文件上限（字节）。50 MB 的 EgoPressure 需要 > 50,050,305。 */
  fileBytes: 60_000_000,

  /** 整个 multipart 请求上限（字节），含文件 + 解析块 + 表单开销。 */
  requestBytes: 72_000_000,

  /** 单篇最多页数。 */
  maxPages: 400,

  /** 单篇最多解析块数。 */
  maxBlocks: 40_000,

  /** 单个解析块的文字上限（保持原值，与模型片段语义绑定）。 */
  blockChars: 6000,

  /**
   * 单篇全文解析字符上限。这是防滥用的兜底值，不是产品功能上限，
   * 正常论文（含 10 万字符的长文）远低于它。
   */
  maxTotalChars: 4_000_000,

  /** blocks JSON 序列化后的请求体上限。 */
  blocksPayloadBytes: 24_000_000,

  /** 解析质量报告的 JSON 上限（每页一条，400 页很宽裕）。 */
  parsingReportBytes: 400_000,

  /** 每个课题的文献数上限。 */
  papersPerProject: 100,

  /** 每个课题的字段数上限。 */
  fieldsPerProject: 30,

  /**
   * 分段存储的目标大小（字符）。单篇解析文本超过它就切成多段
   * R2 对象保存，读取时再按需拼装。
   */
  segmentChars: 250_000,

  /** 导入记录（含失败原因）保留的条数，写入课题状态以便刷新后仍可查。 */
  importLogEntries: 80,

  /** 被丢弃的提取/构图候选保留的条数（写入课题状态，刷新后仍可查）。 */
  rejectedCandidates: 300,

  /**
   * 课题状态快照（D1 单行）上限。文献元数据与导入记录都进这里，
   * 因此需要随篇数与记录条数一起放宽。
   */
  stateBytes: 3_000_000,

  /** 单页 OCR：渲染图像与请求体上限（受模型图像通道约束，保持原值）。 */
  ocrImageBytes: 2_800_000,
  ocrImageEdge: 2400,
  ocrBlockChars: 30_000,

  /**
   * 单次模型任务的输入预算（字符）。
   * 超过预算时按页顺序选取并在记录里标注实际覆盖范围，
   * 不静默截断、不丢页信息。
   */
  modelInputChars: {
    extract: 600_000,
    graphExcerpts: 600_000,
    bridge: 200_000,
    reader: 240_000,
  },
} as const;

/** 人类可读的文件大小限制，用于界面与报错文案。 */
export const FILE_MB = Math.round(LIMITS.fileBytes / 1_000_000);
export const TOTAL_CHARS_LABEL = LIMITS.maxTotalChars.toLocaleString('en-US');

/** 单次模型任务输入预算。 */
export function modelInputBudget(task: keyof typeof LIMITS.modelInputChars) {
  return LIMITS.modelInputChars[task];
}

/**
 * 把一组带字符量的条目按顺序装入预算，返回选中项与实际覆盖范围。
 * 用于「只限制单次模型任务输入量」而保持全文存储完整。
 */
export function takeWithinBudget<T>(
  items: T[],
  charCount: (item: T) => number,
  budget: number,
) {
  const selected: T[] = [];
  let used = 0;
  for (const item of items) {
    const size = charCount(item);
    if (used + size > budget) break;
    selected.push(item);
    used += size;
  }
  return {
    selected,
    used,
    budget,
    /** true 表示本次任务只用到了全文的一部分。 */
    partial: selected.length < items.length,
    omitted: items.length - selected.length,
  };
}

/** 用于界面：把选中的块换算成本次任务实际覆盖的页范围。 */
export function pageRange(pages: number[]) {
  if (!pages.length) return null;
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  return { from: sorted[0], to: sorted[sorted.length - 1], count: sorted.length };
}

/**
 * 把条目按预算切成多批，保证每一批都能单独作为一次模型任务。
 * 与「截断」不同：所有条目都会被分配进某个批次，不会丢弃。
 */
export function batchByBudget<T>(
  items: T[],
  charCount: (item: T) => number,
  budget: number,
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let used = 0;
  for (const item of items) {
    const size = charCount(item);
    // 单个条目本身就超预算时，也单独成批，避免被无声丢弃
    if (current.length && used + size > budget) {
      batches.push(current);
      current = [];
      used = 0;
    }
    current.push(item);
    used += size;
  }
  if (current.length) batches.push(current);
  return batches.length ? batches : [[]];
}
