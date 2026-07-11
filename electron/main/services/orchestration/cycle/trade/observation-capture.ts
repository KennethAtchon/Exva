import type { LLMRunResult } from "../../../llm/llm-types";
import type { TradeSignal } from "@electron/shared/ai/trade-signals";
import type { ObservationAction } from "@electron/shared/domain";
import { requireExperience } from "../../../../experiences/index";
import { SignalObservationService } from "../../../research/signal-observation-service";
import type { TradingCycleContext } from "../trading-cycle-context";
import type { TradeCycleContext } from "../types";

/**
 * Records a point-in-time signal observation for the cycle — traded OR skipped
 * (P1/P3). Non-blocking: observation capture is research substrate and must
 * never break the trade pipeline.
 */
export function captureSignalObservation(
  ctx: TradingCycleContext,
  context: TradeCycleContext,
  decision: LLMRunResult<TradeSignal>,
  referencePrice: number | null,
  eventTime: string,
): void {
  try {
    const session = ctx.deps.sessionRepo.requireById(ctx.sessionId);
    const experience = requireExperience(session.experienceId);
    const action: ObservationAction =
      decision.output.action === "buy"
        ? "buy"
        : decision.output.action === "sell"
          ? "sell"
          : "skip";

    const service = new SignalObservationService(
      ctx.deps.signalObservationsRepo,
    );
    const edgeEstimate =
      ctx.deps.decisionTracesRepo.getByCycle(context.cycleId)?.edgeEstimate ??
      null;
    service.record({
      sessionId: ctx.sessionId,
      experienceId: session.experienceId,
      signalId: context.signalId ?? context.instrument.symbol,
      cycleId: context.cycleId,
      instrumentSymbol: context.instrument.symbol,
      instrumentClass: context.instrument.instrumentClass,
      action,
      eventTime,
      features: {
        confidence: decision.output.confidence,
        executionStrategy: decision.output.executionStrategy,
        reasoning: decision.output.reasoning,
      },
      reasoning: decision.output.reasoning,
      edge: edgeEstimate,
      modelVersion: decision.run.model ?? null,
      referencePrice,
      contract: experience.researchContract,
    });
  } catch (err) {
    ctx.deps.logger.warn(
      { err, sessionId: ctx.sessionId, cycleId: context.cycleId },
      "signal observation capture failed (non-blocking)",
    );
  }
}
