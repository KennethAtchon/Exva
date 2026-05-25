import { AppError } from "@electron/shared/infra/errors";
import type { LLMRunResult } from "../../llm/llm-types";
import type { DeclarativeCycleStageConfig } from "../execution/input-builder-registry";
import {
  runEngineChainStage,
  runEngineStage,
} from "../execution/stage-dispatch";
import type {
  InstrumentAnalysisContext,
  InstrumentAnalysisState,
} from "./types";

export async function runAnalysisStep(
  config: DeclarativeCycleStageConfig,
  ctx: InstrumentAnalysisContext,
  state: InstrumentAnalysisState,
): Promise<InstrumentAnalysisState> {
  switch (config.kind) {
    case "engine":
      return runEngineStage(config.engine, ctx, state);
    case "engine-chain":
      if (config.skipIf?.(state)) return state;
      return runEngineChainStage(config.engines, ctx, state);
    case "phase": {
      const result = await ctx.runAIPhase(
        config.phase,
        config.buildInput(ctx, state),
      );
      const agentResult = toLLMRunResult(result);
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

function toLLMRunResult<T>(result: {
  output: T;
  run?: LLMRunResult<T>["run"];
  message?: LLMRunResult<T>["message"];
}): LLMRunResult<T> {
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

export function buildAnalysisStepExecute(config: DeclarativeCycleStageConfig) {
  return (ctx: InstrumentAnalysisContext, state: InstrumentAnalysisState) =>
    runAnalysisStep(config, ctx, state);
}
