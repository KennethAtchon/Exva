import { runEngineForWorker } from "./engine-prompt-injector";
import type { EngineRunCtx, EngineStageConfig } from "./input-builder-registry";
import { getSignalEngineInputBuilder } from "./input-builder-registry";
import type { InstrumentAnalysisState } from "../analysis/types";

export async function runEngineStage(
  config: EngineStageConfig,
  ctx: EngineRunCtx,
  state: InstrumentAnalysisState,
): Promise<InstrumentAnalysisState> {
  const builder = getSignalEngineInputBuilder(config.inputBuilderId);
  const built = await Promise.resolve(builder.build({ planCtx: ctx, state }));
  const output = runEngineForWorker({
    phase: config.bindingPhase,
    sessionId: ctx.sessionId,
    cycleId: ctx.cycleId,
    strategyContext: ctx.strategyContext,
    bindings: [],
    binding: { engine: config.engineId, kind: config.engineKind, mode: "read" },
    task: built.task as Record<string, unknown>,
  });
  const patched = built.statePatch ? { ...state, ...built.statePatch } : state;
  return builder.applyOutput?.(patched, output) ?? patched;
}

export async function runEngineChainStage(
  engines: EngineStageConfig[],
  ctx: EngineRunCtx,
  state: InstrumentAnalysisState,
): Promise<InstrumentAnalysisState> {
  let current = state;
  for (const engine of engines) {
    current = await runEngineStage(engine, ctx, current);
  }
  return current;
}
