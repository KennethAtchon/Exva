import type { WorkerDefinition } from "@electron/shared/ai/pipeline-phase";
import { AppError } from "@electron/shared/infra/errors";

export interface WorkerGraphNode<TOutput = unknown> {
  worker: WorkerDefinition<unknown, TOutput>;
  frontier: number;
}

export interface WorkerGraphScheduleResult<TOutput = unknown> {
  ordered: WorkerGraphNode<TOutput>[];
  maxConcurrency: number;
  schedulingMode: "flat_parallel" | "dependency_graph";
}

export function buildWorkerSchedule<TOutput = unknown>(
  workers: readonly WorkerDefinition<unknown, TOutput>[],
  scheduling: { mode: "flat_parallel" | "dependency_graph"; maxConcurrency: number } | undefined,
): WorkerGraphScheduleResult<TOutput> {
  const mode = scheduling?.mode ?? "flat_parallel";
  const maxConcurrency = scheduling?.maxConcurrency ?? Math.max(1, workers.length);

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
    if (frontierMemo.has(workerId)) return frontierMemo.get(workerId)!;
    const worker = workerMap.get(workerId);
    if (!worker) throw new AppError(`Unknown worker '${workerId}' in schedule build.`, "VALIDATION_FAILED");
    const deps = worker.dependsOn ?? [];
    const frontier = deps.length === 0 ? 0 : Math.max(...deps.map(visit)) + 1;
    frontierMemo.set(workerId, frontier);
    return frontier;
  };

  return {
    ordered: workers.map((worker) => ({ worker, frontier: visit(worker.id) })).sort((a, b) => a.frontier - b.frontier),
    maxConcurrency,
    schedulingMode: mode,
  };
}

export async function executeByFrontier<T>(
  scheduled: readonly WorkerGraphNode[],
  maxConcurrency: number,
  runWorker: (node: WorkerGraphNode) => Promise<T>,
  shouldContinue?: () => boolean,
): Promise<Array<{ node: WorkerGraphNode; result: T }>> {
  const frontierMap = new Map<number, WorkerGraphNode[]>();
  for (const node of scheduled) {
    const current = frontierMap.get(node.frontier) ?? [];
    current.push(node);
    frontierMap.set(node.frontier, current);
  }

  const out: Array<{ node: WorkerGraphNode; result: T }> = [];

  for (const frontier of [...frontierMap.keys()].sort((a, b) => a - b)) {
    if (shouldContinue && !shouldContinue()) break;
    const nodes = frontierMap.get(frontier) ?? [];
    for (let index = 0; index < nodes.length; index += Math.max(1, maxConcurrency)) {
      if (shouldContinue && !shouldContinue()) break;
      const batch = nodes.slice(index, index + Math.max(1, maxConcurrency));
      const results = await Promise.all(batch.map(async (node) => ({ node, result: await runWorker(node) })));
      out.push(...results);
      if (shouldContinue && !shouldContinue()) break;
    }
  }

  return out;
}
