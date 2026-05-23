import PQueue from "p-queue";
import { createLogger } from "../../infra/log";

const logger = createLogger("pipeline-runtime");

export async function runConcurrentGroup<T>(
  tasks: Array<() => Promise<T>>,
  maxConcurrency: number,
  shouldContinue?: () => boolean,
): Promise<Array<PromiseSettledResult<T>>> {
  const queue = new PQueue({ concurrency: Math.max(1, maxConcurrency) });
  const results: Array<PromiseSettledResult<T>> = [];
  const groupStartedAt = Date.now();
  logger.info(
    {
      taskCount: tasks.length,
      maxConcurrency: Math.max(1, maxConcurrency),
    },
    "worker group dispatch start",
  );
  for (
    let index = 0;
    index < tasks.length;
    index += Math.max(1, maxConcurrency)
  ) {
    if (shouldContinue && !shouldContinue()) {
      logger.warn(
        {
          dispatchedTasks: results.length,
          remainingTasks: tasks.length - index,
        },
        "worker group dispatch aborted (spend cap)",
      );
      break;
    }
    const batch = tasks.slice(index, index + Math.max(1, maxConcurrency));
    const batchStartedAt = Date.now();
    logger.info(
      {
        batchIndex: Math.floor(index / Math.max(1, maxConcurrency)),
        batchSize: batch.length,
        batchStartIndex: index,
      },
      "worker group batch start",
    );
    const batchResults = await Promise.all(
      batch.map((task) =>
        queue
          .add(async () => task())
          .then(
            (value) =>
              ({ status: "fulfilled", value }) as PromiseSettledResult<T>,
            (reason) =>
              ({ status: "rejected", reason }) as PromiseSettledResult<T>,
          ),
      ),
    );
    results.push(...batchResults);
    logger.info(
      {
        batchIndex: Math.floor(index / Math.max(1, maxConcurrency)),
        batchSize: batch.length,
        fulfilledCount: batchResults.filter(
          (entry) => entry.status === "fulfilled",
        ).length,
        rejectedCount: batchResults.filter(
          (entry) => entry.status === "rejected",
        ).length,
        durationMs: Date.now() - batchStartedAt,
      },
      "worker group batch complete",
    );
    if (shouldContinue && !shouldContinue()) break;
  }
  logger.info(
    {
      taskCount: tasks.length,
      fulfilledCount: results.filter((entry) => entry.status === "fulfilled")
        .length,
      rejectedCount: results.filter((entry) => entry.status === "rejected")
        .length,
      durationMs: Date.now() - groupStartedAt,
    },
    "worker group dispatch complete",
  );
  return results;
}
