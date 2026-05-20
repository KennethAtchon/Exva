import { AppError } from "@electron/shared/infra/errors";
import type { AgentResult } from "../../../ai-runtime/ai-runtime-types";
import type { DeclarativeCycleStageConfig } from "../engine/input-builder-registry";
import { runEngineChainStage, runEngineStage } from "../engine/stage-dispatch";
import type { CyclePlanRunContext, TradeCyclePlanState } from "./types";

export async function runDeclarativeStage(
  config: DeclarativeCycleStageConfig,
  ctx: CyclePlanRunContext,
  state: TradeCyclePlanState,
): Promise<TradeCyclePlanState> {
  switch (config.kind) {
    case "engine":
      return runEngineStage(config.engine, ctx, state);
    case "engine-chain":
      if (config.skipIf?.(state)) return state;
      return runEngineChainStage(config.engines, ctx, state);
    case "phase": {
      const result = await ctx.runPhasePlan(
        config.phase,
        config.buildInput(ctx, state),
      );
      const agentResult = toAgentResult(result);
      if (config.phase !== "decision" && !hasSymbolOutput(agentResult.output)) {
        throw new AppError(
          `${config.phase} phase returned no signal.`,
          "VALIDATION_FAILED",
        );
      }
      return config.applyOutput(state, agentResult);
    }
    default:
      return state;
  }
}

function toAgentResult<T>(result: {
  output: T;
  run?: AgentResult<T>["run"];
  message?: AgentResult<T>["message"];
}): AgentResult<T> {
  if (!result.run || !result.message) {
    throw new AppError(
      "Phase plan did not return agent run metadata.",
      "VALIDATION_FAILED",
    );
  }
  return { run: result.run, message: result.message, output: result.output };
}

function hasSymbolOutput(output: unknown): boolean {
  return Boolean(
    output &&
    typeof output === "object" &&
    "symbol" in output &&
    (output as { symbol?: string }).symbol,
  );
}

export function buildCycleStageExecute(config: DeclarativeCycleStageConfig) {
  return (ctx: CyclePlanRunContext, state: TradeCyclePlanState) =>
    runDeclarativeStage(config, ctx, state);
}
