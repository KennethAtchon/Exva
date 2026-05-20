import type { EngineBinding, PipelinePhase } from "@electron/shared/ai/pipeline-phase";
import type { SessionStrategyContext } from "@electron/shared/domain";
import { getEngine } from "../../engines/registry/engine-registry";
import type { EngineRunContext } from "../../engines/registry/types";

export interface EngineContextRunInput {
  phase: PipelinePhase;
  sessionId: string;
  cycleId: string | null;
  strategyContext: SessionStrategyContext;
  bindings: readonly EngineBinding[];
  task: Record<string, unknown>;
}

/** Runs read-mode engine bindings and returns structured context for the worker payload. */
export function runReadEngineContext(input: EngineContextRunInput): Record<string, unknown> {
  const ctx: EngineRunContext = {
    sessionId: input.sessionId,
    phase: input.phase,
    cycleId: input.cycleId,
    strategyContext: input.strategyContext,
  };

  const engineResults: Record<string, unknown> = {};
  for (const binding of input.bindings) {
    if (binding.mode !== "read") continue;
    const engine = getEngine(binding.engine);
    if (!engine) continue;
    engineResults[binding.engine] = engine.run(input.task, ctx);
  }
  return engineResults;
}
