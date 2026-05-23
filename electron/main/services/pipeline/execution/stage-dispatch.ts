import { runEngineBinding } from "./engine-context-runner";
import type { EngineRunCtx, EngineStageConfig } from "./input-builder-registry";
import { getEngineInputBuilder } from "./input-builder-registry";
import type { TradeCyclePlanState } from "../analysis/types";

export async function runEngineStage(
  config: EngineStageConfig,
  ctx: EngineRunCtx,
  state: TradeCyclePlanState,
): Promise<TradeCyclePlanState> {
  const builder = getEngineInputBuilder(config.inputBuilderId);
  const built = await Promise.resolve(builder.build({ planCtx: ctx, state }));
  const output = runEngineBinding({
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
  state: TradeCyclePlanState,
): Promise<TradeCyclePlanState> {
  let current = state;
  for (const engine of engines) {
    current = await runEngineStage(engine, ctx, current);
  }
  return current;
}
