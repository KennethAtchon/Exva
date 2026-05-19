import PQueue from "p-queue";

export async function runConcurrentGroup<T>(
  tasks: Array<() => Promise<T>>,
  maxConcurrency: number,
  shouldContinue?: () => boolean,
): Promise<Array<PromiseSettledResult<T>>> {
  const queue = new PQueue({ concurrency: Math.max(1, maxConcurrency) });
  const results: Array<PromiseSettledResult<T>> = [];
  for (let index = 0; index < tasks.length; index += Math.max(1, maxConcurrency)) {
    if (shouldContinue && !shouldContinue()) break;
    const batch = tasks.slice(index, index + Math.max(1, maxConcurrency));
    const batchResults = await Promise.all(
      batch.map((task) =>
        queue.add(async () => task()).then(
          (value) => ({ status: "fulfilled", value }) as PromiseSettledResult<T>,
          (reason) => ({ status: "rejected", reason }) as PromiseSettledResult<T>,
        ),
      ),
    );
    results.push(...batchResults);
    if (shouldContinue && !shouldContinue()) break;
  }
  return results;
}
