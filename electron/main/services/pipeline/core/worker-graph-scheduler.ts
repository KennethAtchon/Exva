import type { WorkerDefinition } from "@electron/shared/ai/ai-phase";
import { AppError } from "@electron/shared/infra/errors";

interface AIWorkerNode<TOutput = unknown> {
  worker: WorkerDefinition<TOutput>;
  frontier: number;
}

export interface AIWorkerSchedule<TOutput = unknown> {
  ordered: AIWorkerNode<TOutput>[];
  maxConcurrency: number;
  schedulingMode: "flat_parallel" | "dependency_graph";
}

export function scheduleWorkersByDependency<TOutput = unknown>(
  workers: readonly WorkerDefinition<TOutput>[],
  scheduling:
    | { mode: "flat_parallel" | "dependency_graph"; maxConcurrency: number }
    | undefined,
): AIWorkerSchedule<TOutput> {
  const mode = scheduling?.mode ?? "flat_parallel";
  const maxConcurrency =
    scheduling?.maxConcurrency ?? Math.max(1, workers.length);

  if (mode === "flat_parallel") {
    return {
      ordered: workers.map((worker) => ({ worker, frontier: 0 })),
      maxConcurrency,
      schedulingMode: mode,
    };
  }

  const workerMap = new Map(workers.map((worker) => [worker.id, worker]));
  const frontierMemo = new Map<string, number>();
  const visit = (workerId: string): number => {
    const cachedFrontier = frontierMemo.get(workerId);
    if (cachedFrontier !== undefined) return cachedFrontier;
    const worker = workerMap.get(workerId);
    if (!worker)
      throw new AppError(
        `Unknown worker '${workerId}' in schedule build.`,
        "VALIDATION_FAILED",
      );
    const deps = worker.dependsOn ?? [];
    const frontier = deps.length === 0 ? 0 : Math.max(...deps.map(visit)) + 1;
    frontierMemo.set(workerId, frontier);
    return frontier;
  };

  return {
    ordered: workers
      .map((worker) => ({ worker, frontier: visit(worker.id) }))
      .sort((a, b) => a.frontier - b.frontier),
    maxConcurrency,
    schedulingMode: mode,
  };
}

export async function runWorkerBatches<T>(
  scheduled: readonly AIWorkerNode[],
  maxConcurrency: number,
  runWorker: (node: AIWorkerNode) => Promise<T>,
  shouldContinue?: () => boolean,
): Promise<Array<{ node: AIWorkerNode; result: T }>> {
  const frontierMap = new Map<number, AIWorkerNode[]>();
  for (const node of scheduled) {
    const current = frontierMap.get(node.frontier) ?? [];
    current.push(node);
    frontierMap.set(node.frontier, current);
  }

  const out: Array<{ node: AIWorkerNode; result: T }> = [];

  for (const frontier of [...frontierMap.keys()].sort((a, b) => a - b)) {
    if (shouldContinue && !shouldContinue()) break;
    const nodes = frontierMap.get(frontier) ?? [];
    for (
      let index = 0;
      index < nodes.length;
      index += Math.max(1, maxConcurrency)
    ) {
      if (shouldContinue && !shouldContinue()) break;
      const batch = nodes.slice(index, index + Math.max(1, maxConcurrency));
      const results = await Promise.all(
        batch.map(async (node) => ({ node, result: await runWorker(node) })),
      );
      out.push(...results);
      if (shouldContinue && !shouldContinue()) break;
    }
  }

  return out;
}
