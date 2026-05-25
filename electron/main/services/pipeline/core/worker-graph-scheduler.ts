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
