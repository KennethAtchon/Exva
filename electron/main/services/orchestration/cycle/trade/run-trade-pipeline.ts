import {
  CyclePausedError,
  CycleStageFailedError,
  type TradeCyclePlanState,
  type TradePipelineResult,
} from "../../../ai/pipeline-runtime/plan/cycle-types";
import type { OrchestratorContext } from "../orchestrator-context";
import { runOrchestratorStep } from "../orchestrator-step";
import type { TradeCycleContext } from "../types";

export async function runTradePipeline(
  ctx: OrchestratorContext,
  context: TradeCycleContext,
  onRetry: () => void,
): Promise<TradePipelineResult | null> {
  const config = ctx.getSessionConfig();
  const session = ctx.deps.sessionRepo.requireById(ctx.sessionId);
  const seedState = tradePipelineSeedFromContext(context);

  try {
    return await ctx.deps.ai.runCycle("default-trade-cycle", {
      sessionId: ctx.sessionId,
      cycleId: context.cycleId,
      tradeId: context.trade?.id ?? null,
      instrument: context.instrument,
      sessionConfig: config,
      instrumentClasses: ctx.getEffectiveInstrumentClasses(session),
      seedState,
      runStep: async (stage, execute) => {
        const step = await runOrchestratorStep(ctx, {
          cycleId: context.cycleId,
          stage,
          onRetry,
          tradeId: context.trade?.id ?? null,
          recordFailure: stage === "candidate_validation" ? false : true,
          onFailure:
            stage === "candidate_validation"
              ? (result) => {
                  ctx.emitEvent(
                    "WARN",
                    null,
                    `[candidate-validation] ${context.instrument.symbol}: ${result.errorMessage}`,
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
  return {
    technical: context.technical,
    fundamental: context.fundamental,
    review: context.review,
    decision: context.decision,
    riskOrder: context.riskOrder,
  };
}

export function applyTradePipelineToContext(context: TradeCycleContext, result: TradePipelineResult): void {
  context.technical = result.state.technical ?? context.technical;
  context.fundamental = result.state.fundamental ?? context.fundamental;
  context.review = result.state.review ?? context.review;
  context.decision = result.state.decision ?? context.decision;
  context.riskOrder = result.state.riskOrder ?? context.riskOrder;
}
