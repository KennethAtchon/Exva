import type { SessionConfig } from "@/lib/types";
import { AppError } from "@electron/shared/infra/errors";
import type { SelectorEvidence } from "@electron/shared/ai/selector-pipeline-candidate";
import type { TechnicalSignal, FundamentalSignal, ReviewSignal, TradeSignal } from "@electron/shared/ai/pipeline-signals";
import type { ExecutionStepRunner } from "../execution-step-runner";
import type { OrchestratorContext } from "../orchestrator-context";
import type { AiPipelineResult, TradeCycleContext } from "../types";

export async function runAiPipeline(
  ctx: OrchestratorContext,
  context: TradeCycleContext,
  config: SessionConfig,
  stepRunner: ExecutionStepRunner,
  onRetry: () => void,
): Promise<AiPipelineResult | null> {
  const instrument = context.instrument;
  ctx.deps.logger.debug(
    { sessionId: ctx.sessionId, instrumentSymbol: instrument.symbol, instrumentClass: instrument.instrumentClass },
    "ai pipeline start",
  );

  if (!context.technical) {
    const technical = await stepRunner.run(
      "technical",
      async () => {
        const result = await ctx.deps.ai.runPhase<
          { instrumentSymbol: string; selectorEvidence?: SelectorEvidence | null },
          TechnicalSignal
        >("technical", ctx.sessionId, { instrumentSymbol: instrument.symbol, selectorEvidence: instrument.selectorEvidence ?? null }, context.cycleId);
        if (!result.output.symbol) {
          throw new AppError("Technical phase returned no signal.", "VALIDATION_FAILED");
        }
        return result;
      },
      { onRetry },
    );
    if (!technical.ok) {
      ctx.handleStepFailure("technical", context.cycleId, technical);
      return null;
    }
    context.technical = technical.value;
  }
  if (!ctx.runtimeIsActive()) return ctx.emitAbort();

  if (!context.fundamental) {
    const fundamental = await stepRunner.run(
      "fundamental",
      async () => {
        const result = await ctx.deps.ai.runPhase<
          { instrumentSymbol: string; selectorEvidence?: SelectorEvidence | null },
          FundamentalSignal
        >("fundamental", ctx.sessionId, { instrumentSymbol: instrument.symbol, selectorEvidence: instrument.selectorEvidence ?? null }, context.cycleId);
        if (!result.output.symbol) {
          throw new AppError("Fundamental phase returned no signal.", "VALIDATION_FAILED");
        }
        return result;
      },
      { onRetry },
    );
    if (!fundamental.ok) {
      ctx.handleStepFailure("fundamental", context.cycleId, fundamental);
      return null;
    }
    context.fundamental = fundamental.value;
  }
  if (!ctx.runtimeIsActive()) return ctx.emitAbort();

  if (!context.review) {
    const technical = context.technical;
    const fundamental = context.fundamental;
    if (!technical || !fundamental) {
      throw new AppError("Internal error: analyses missing at review step", "VALIDATION_FAILED");
    }
    const review = await stepRunner.run(
      "review",
      async () => {
        const result = await ctx.deps.ai.runPhase<
          { instrumentSymbol: string; technical: TechnicalSignal; fundamental: FundamentalSignal },
          ReviewSignal
        >("review", ctx.sessionId, {
          instrumentSymbol: instrument.symbol,
          technical: technical.output,
          fundamental: fundamental.output,
        }, context.cycleId);
        if (!result.output.symbol) {
          throw new AppError("Review phase returned no signal.", "VALIDATION_FAILED");
        }
        return result;
      },
      { onRetry },
    );
    if (!review.ok) {
      ctx.handleStepFailure("review", context.cycleId, review);
      return null;
    }
    context.review = review.value;
  }
  if (!ctx.runtimeIsActive()) return ctx.emitAbort();

  if (!context.decision) {
    const technical = context.technical;
    const fundamental = context.fundamental;
    const review = context.review;
    if (!technical || !fundamental || !review) {
      throw new AppError("Internal error: analyses missing at decision step", "VALIDATION_FAILED");
    }
    const decision = await stepRunner.run(
      "decision",
      () =>
        ctx.deps.ai.runPhase<
          { instrumentSymbol: string; technical: TechnicalSignal; fundamental: FundamentalSignal; review: ReviewSignal },
          TradeSignal
        >("decision", ctx.sessionId, {
          instrumentSymbol: instrument.symbol,
          technical: technical.output,
          fundamental: fundamental.output,
          review: review.output,
        }, context.cycleId),
      { onRetry },
    );
    if (!decision.ok) {
      ctx.handleStepFailure("decision", context.cycleId, decision);
      return null;
    }
    context.decision = decision.value;
  }
  if (!ctx.runtimeIsActive()) return ctx.emitAbort();

  ctx.deps.logger.debug(
    {
      sessionId: ctx.sessionId,
      instrumentSymbol: instrument.symbol,
      decisionAction: context.decision.output.action,
      confidence: context.decision.output.confidence,
    },
    "ai pipeline complete",
  );

  return {
    technical: context.technical,
    fundamental: context.fundamental,
    review: context.review,
    decision: context.decision,
  };
}
