// One failed item must never prevent later documents from being processed.
export async function runBatch<T>(
  items: T[],
  perform: (item: T, index: number) => Promise<void>,
) {
  const failures: { item: T; message: string }[] = [];
  let succeeded = 0;
  for (let i = 0; i < items.length; i++) {
    try {
      await perform(items[i], i);
      succeeded++;
    } catch (error) {
      failures.push({
        item: items[i],
        message: error instanceof Error ? error.message : '处理失败',
      });
    }
  }
  return { succeeded, failures, total: items.length };
}
