import type {
  EngineBinding,
  PipelinePhase,
} from "@electron/shared/ai/ai-phase";
import type { SessionStrategyContext } from "@electron/shared/domain";
import { requireEngine } from "../../signal/registry/signal-engine-registry";
import type { SignalEngineContext } from "../../signal/registry/types";
import { createLogger } from "../../infra/log";

const logger = createLogger("pipeline-runtime");

export interface EngineInjectionInput {
  phase: PipelinePhase;
  sessionId: string;
  cycleId: string | null;
  strategyContext: SessionStrategyContext;
  bindings: readonly EngineBinding[];
  task: Record<string, unknown>;
}

export interface EngineRunInput extends EngineInjectionInput {
  binding: EngineBinding;
}

/** Runs read-mode engine bindings and returns structured context for the worker payload. */
export function injectEngineResults(
  input: EngineInjectionInput,
): Record<string, unknown> {
  const engineResults: Record<string, unknown> = {};
  const readBindings = input.bindings.filter(
    (binding) => binding.mode === "read",
  );
  if (readBindings.length === 0) return engineResults;

  logger.info(
    {
      sessionId: input.sessionId,
      phase: input.phase,
      cycleId: input.cycleId,
      engineIds: readBindings.map((binding) => binding.engine),
      taskKeys: Object.keys(input.task).sort(),
    },
    "worker engine context read start",
  );

  for (const binding of readBindings) {
    const startedAt = Date.now();
    engineResults[binding.engine] = runEngineForWorker({ ...input, binding });
    logger.info(
      {
        sessionId: input.sessionId,
        phase: input.phase,
        cycleId: input.cycleId,
        engineId: binding.engine,
        durationMs: Date.now() - startedAt,
        hasResult: engineResults[binding.engine] != null,
      },
      "worker engine context read complete",
    );
  }
  return engineResults;
}

export function runEngineForWorker<TOutput = unknown>(
  input: EngineRunInput,
): TOutput {
  const engine = requireEngine(input.binding.engine);
  if (engine.kind !== input.binding.kind) {
    throw new Error(
      `Engine '${input.binding.engine}' was bound as kind '${input.binding.kind}' but registry kind is '${engine.kind}'.`,
    );
  }
  const ctx: SignalEngineContext = {
    sessionId: input.sessionId,
    phase: input.phase,
    cycleId: input.cycleId,
    strategyContext: input.strategyContext,
  };
  return engine.run(input.task, ctx) as TOutput;
}
