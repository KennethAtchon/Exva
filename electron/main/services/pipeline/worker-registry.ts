import type { WorkerDefinition } from "@electron/shared/ai/ai-phase";
import type { PipelinePhase } from "@electron/shared/ai/ai-phase";
import type { SignalSourceType } from "@electron/shared/domain";

/** All registered workers indexed by stable id. */
const WORKER_INDEX = new Map<string, WorkerDefinition>();

export function registerWorkers(workers: readonly WorkerDefinition[]): void {
  for (const worker of workers) {
    WORKER_INDEX.set(worker.id, worker);
  }
}

export const PIPELINE_WORKER_SETS = {
  catalystTrade: {
    technical: ["price-reaction-checker", "volume-profile"] as const,
    fundamental: ["document-extractor", "market-reaction-checker"] as const,
    review: ["conflict-detector", "risk-assessor"] as const,
    decision: ["signal-classifier", "entry-timer"] as const,
  },
  defaultTrade: {
    technical: ["price-reaction-checker", "volume-profile"] as const,
    fundamental: ["earnings-context", "catalyst-context"] as const,
    review: ["conflict-detector", "risk-assessor"] as const,
    decision: ["signal-classifier", "entry-timer"] as const,
  },
  catalystTwoCall: {
    fundamental: ["catalyst-analyst"] as const,
    review: ["adversarial-reviewer"] as const,
    decision: [] as const,
  },
  selector: {
    catalyst: ["catalyst-feed-scout"] as const,
    standard: ["web-scout"] as const,
    event: ["event-web-scout", "event-prediction-scout"] as const,
  },
} as const;

export function resolveWorkersByIds(
  ids: readonly string[],
): readonly WorkerDefinition[] {
  return ids.map((id) => {
    const worker = WORKER_INDEX.get(id);
    if (!worker) {
      throw new Error(
        `Worker '${id}' is not registered in the worker registry.`,
      );
    }
    return worker;
  });
}

export function resolvePipelinePhaseWorkerIds(
  phaseWorkers: Partial<Record<PipelinePhase, readonly string[]>>,
  phase: PipelinePhase,
): readonly string[] {
  return phaseWorkers[phase] ?? [];
}

/** Selector discovery workers by signal source (front-door routing). */
export function resolveSelectorWorkerIds(
  sourceType: SignalSourceType | undefined,
): readonly string[] {
  if (!sourceType || sourceType === "edgar_8k" || sourceType === "mock") {
    return [];
  }
  if (sourceType === "timer") return [];
  if (sourceType === "prediction_event") {
    return [...PIPELINE_WORKER_SETS.selector.event];
  }
  if (sourceType === "web_search" || sourceType === "manual") {
    return [...PIPELINE_WORKER_SETS.selector.standard];
  }
  return [...PIPELINE_WORKER_SETS.selector.standard];
}
