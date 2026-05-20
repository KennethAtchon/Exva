import { AppError } from "@electron/shared/infra/errors";
import type { AgentResult } from "../../../ai/ai-runtime/ai-runtime-types";
import type { TradePipelineResult } from "../../../ai/pipeline-runtime/plan/cycle/types";
import { tradeCycleStageFailurePolicy } from "../../../ai/pipeline-runtime/plan/plans/trade/default-cycle-stages";
import type { OrchestratorContext } from "../orchestrator-context";
import { runOrchestratorStep } from "../orchestrator-step";
import type { TradeCycleContext } from "../types";
import {
  CyclePausedError,
  CycleStageFailedError,
  type TradeCyclePlanState,
} from "../../../ai/pipeline-runtime/plan/cycle/types";

const TRADE_PIPELINE_CONTEXT_STATE_KEYS = ["technical", "fundamental", "review", "decision", "riskOrder"] as const;

type TradePipelineContextStateKey = (typeof TRADE_PIPELINE_CONTEXT_STATE_KEYS)[number];

export async function runTradePipeline(
  ctx: OrchestratorContext,
  context: TradeCycleContext,
  onRetry: () => void,
): Promise<TradePipelineResult | null> {
  const config = ctx.getSessionConfig();
  const session = ctx.deps.sessionRepo.requireById(ctx.sessionId);
  const seedState = tradePipelineSeedFromContext(context);

  try {
    const result = await ctx.deps.ai.runPlan("default-trade-cycle", {
      sessionId: ctx.sessionId,
      cycleId: context.cycleId,
      tradeId: context.trade?.id ?? null,
      instrument: context.instrument,
      sessionConfig: config,
      instrumentClasses: ctx.getEffectiveInstrumentClasses(session),
      seedState,
      runStep: async (stage, execute) => {
        const failurePolicy = tradeCycleStageFailurePolicy(stage);
        const step = await runOrchestratorStep(ctx, {
          cycleId: context.cycleId,
          stage,
          onRetry,
          tradeId: context.trade?.id ?? null,
          recordFailure: failurePolicy !== "warn",
          onFailure:
            failurePolicy === "warn"
              ? (result) => {
                  ctx.emitEvent(
                    "WARN",
                    null,
                    `[${stage}] ${context.instrument.symbol}: ${result.errorMessage}`,
                    "orchestrator",
                    context.cycleId,
                  );
                }
              : undefined,
          run: execute,
        });

        if (step.status === "paused") throw new CyclePausedError();
        if (step.status === "failed") throw new CycleStageFailedError(stage, step.result.errorMessage);
        return step.value;
      },
    });
    return result as TradePipelineResult;
  } catch (error) {
    if (error instanceof CyclePausedError) {
      ctx.emitAbort();
      return null;
    }
    if (error instanceof CycleStageFailedError) {
      if (error.stage === "risk_gate" && context.trade) {
        ctx.deps.tradesRepo.updateStatus(context.trade.id, "rejected", 0);
      }
      return null;
    }
    throw error;
  }
}

function tradePipelineSeedFromContext(context: TradeCycleContext): Partial<TradeCyclePlanState> {
  const seedState: Partial<TradeCyclePlanState> = {};
  const target = seedState as Record<TradePipelineContextStateKey, unknown>;
  for (const key of TRADE_PIPELINE_CONTEXT_STATE_KEYS) {
    const value = context[key];
    if (value !== undefined) {
      target[key] = value;
    }
  }
  return seedState;
}

export function applyTradePipelineToContext(context: TradeCycleContext, result: TradePipelineResult): void {
  const target = context as Record<TradePipelineContextStateKey, unknown>;
  const source = result.state as Record<TradePipelineContextStateKey, unknown>;
  for (const key of TRADE_PIPELINE_CONTEXT_STATE_KEYS) {
    const value = source[key];
    if (value !== undefined) {
      target[key] = value;
    }
  }
}

export function persistTradeAiRuns(
  ctx: OrchestratorContext,
  tradeId: string,
  results: Array<AgentResult<unknown>>,
): void {
  for (const result of results) {
    ctx.deps.agentRunsRepo.insert({ ...result.run, session_id: ctx.sessionId, trade_id: tradeId });
    ctx.deps.agentMessagesRepo.insert({ ...result.message, session_id: ctx.sessionId, trade_id: tradeId });
  }
}

export function requirePipelineAiResults(result: TradePipelineResult) {
  const { technical, fundamental, review, decision } = result.state;
  if (!technical || !fundamental || !review || !decision) {
    throw new AppError("Internal error: trade pipeline returned incomplete AI results.", "VALIDATION_FAILED");
  }
  return { technical, fundamental, review, decision };
}
