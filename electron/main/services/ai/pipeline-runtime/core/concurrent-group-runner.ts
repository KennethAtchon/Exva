import PQueue from "p-queue";

export async function runConcurrentGroup<T>(
  tasks: Array<() => Promise<T>>,
  maxConcurrency: number,
): Promise<Array<PromiseSettledResult<T>>> {
  const queue = new PQueue({ concurrency: Math.max(1, maxConcurrency) });
  return Promise.all(tasks.map((task) => queue.add(async () => task()).then(
    (value) => ({ status: "fulfilled", value }) as PromiseSettledResult<T>,
    (reason) => ({ status: "rejected", reason }) as PromiseSettledResult<T>,
  )));
}
