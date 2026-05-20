import type { EngineBinding, PipelinePhase } from "@electron/shared/ai/pipeline-phase";
import type { SessionStrategyContext } from "@electron/shared/domain";
import { requireEngine } from "../../engines/registry/engine-registry";
import type { EngineRunContext } from "../../engines/registry/types";

export interface EngineContextRunInput {
  phase: PipelinePhase;
  sessionId: string;
  cycleId: string | null;
  strategyContext: SessionStrategyContext;
  bindings: readonly EngineBinding[];
  task: Record<string, unknown>;
}

export interface EngineRunInput extends EngineContextRunInput {
  binding: EngineBinding;
}

/** Runs read-mode engine bindings and returns structured context for the worker payload. */
export function runReadEngineContext(input: EngineContextRunInput): Record<string, unknown> {
  const engineResults: Record<string, unknown> = {};
  for (const binding of input.bindings) {
    if (binding.mode !== "read") continue;
    engineResults[binding.engine] = runEngineBinding({ ...input, binding });
  }
  return engineResults;
}

export function runEngineBinding<TOutput = unknown>(input: EngineRunInput): TOutput {
  const engine = requireEngine(input.binding.engine);
  if (engine.kind !== input.binding.kind) {
    throw new Error(
      `Engine '${input.binding.engine}' was bound as kind '${input.binding.kind}' but registry kind is '${engine.kind}'.`,
    );
  }
  const ctx: EngineRunContext = {
    sessionId: input.sessionId,
    phase: input.phase,
    cycleId: input.cycleId,
    strategyContext: input.strategyContext,
  };
  return engine.run(input.task, ctx) as TOutput;
}
