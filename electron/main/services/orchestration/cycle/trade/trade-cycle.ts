import { AppError } from "@electron/shared/infra/errors";
import type { TradingCycleContext } from "../trading-cycle-context";
import { enqueueCycleTask, runOrchestratorStep } from "../orchestrator-step";
import { scheduleCycleRefillAfterDelayIfIdle } from "../scheduling/cycle-refill";
import type { ResolvedInstrument, TradeCycleContext } from "../types";
import type { OrchestrationOutcome } from "../runtime-outcome";
import {
  finalizeOpenedTrade,
  persistPendingTradeFromPipeline,
  placeBrokerOrder,
  runApprovalAndCapital,
} from "./effect-runner";
import {
  applyTradePipelineToContext,
  requirePipelineAiResults,
  runTradePipeline,
} from "./run-trade-pipeline";

function tradeCycleRetry(
  ctx: TradingCycleContext,
  context: TradeCycleContext,
): () => void {
  return () =>
    enqueueCycleTask(
      ctx,
      context.cycleId,
      "Scheduled trade-step retry failed",
      () => executeTradeCycle(ctx, context),
    );
}

function finishWithoutOpenPosition(
  ctx: TradingCycleContext,
  label: string,
  outcome: OrchestrationOutcome = "no_trade",
): void {
  if (!ctx.scheduleSelectorCycle) return;
  if (outcome !== "no_trade" && outcome !== "transient") {
    return;
  }
  scheduleCycleRefillAfterDelayIfIdle(
    ctx,
    ctx.scheduleSelectorCycle,
    label,
    ctx.getFailureRetryMinutes() * 60 * 1000,
  );
}

export async function executeTradeCycle(
  ctx: TradingCycleContext,
  context: TradeCycleContext,
): Promise<void> {
  if (!ctx.runtimeIsActive()) return;
  ctx.cycleContexts.set(context.cycleId, context);
  ctx.deps.logger.debug(
    {
      sessionId: ctx.sessionId,
      instrumentSymbol: context.instrument.symbol,
      instrumentClass: context.instrument.instrumentClass,
    },
    "trade cycle start",
  );

  try {
    const config = ctx.getSessionConfig();
    const retry = tradeCycleRetry(ctx, context);

    const pipeline = await runTradePipeline(ctx, context, retry);
    if (pipeline.status === "paused") return;
    if (pipeline.status === "failed") {
      finishWithoutOpenPosition(
        ctx,
        `${pipeline.stage} failed; scheduling selector retry.`,
        pipeline.result.outcome,
      );
      return;
    }

    applyTradePipelineToContext(context, pipeline.result);
    const latestQuote = pipeline.result.state.quoteSnapshot;
    const { decision } = requirePipelineAiResults(
      pipeline.result,
      context.pipelineId,
    );
    const trade = persistPendingTradeFromPipeline(
      ctx,
      context,
      pipeline.result,
    );

    if (decision.output.action === "skip") {
      ctx.clearAttentionRequired();
      ctx.resetHardFailureStreak();
      const isConfidenceNoTrade = decision.output.reasoning.includes(
        "wait-for-open threshold",
      );
      ctx.recordFailure({
        cycleId: context.cycleId,
        stage: "trade_cycle",
        outcome: "no_trade",
        level: "WARN",
        code: null,
        message: `No trade for ${trade.instrumentSymbol}: ${decision.output.reasoning}`,
        reasonCategory: isConfidenceNoTrade ? "risk_gate" : "model_no_trade",
      });
      ctx.emitEvent(
        isConfidenceNoTrade ? "WARN" : "INFO",
        trade.id,
        isConfidenceNoTrade
          ? `No trade for ${trade.instrumentSymbol}: ${decision.output.reasoning}`
          : `No trade decision for ${trade.instrumentSymbol}; cycle complete.`,
        "orchestrator",
        context.cycleId,
      );
      if (context.signalDeliveryId && context.signalId) {
        ctx.deps.signalDeliveryLifecycle?.complete(context.signalDeliveryId, {
          sessionId: ctx.sessionId,
          signalId: context.signalId,
          status: "rejected",
          dropReason: isConfidenceNoTrade
            ? "confidence_below_threshold"
            : "decision_skip",
        });
      }
      finishWithoutOpenPosition(ctx, "No-trade cycle complete", "no_trade");
      return;
    }

    const riskOrder = context.riskOrder ?? pipeline.result.state.riskOrder;
    if (!riskOrder) {
      throw new AppError(
        "Internal error: riskOrder missing after trade pipeline",
        "VALIDATION_FAILED",
      );
    }
    context.riskOrder = riskOrder;

    const brokerAccountId =
      pipeline.result.state.brokerAccountId ??
      ctx.resolveBrokerAccountId(context.instrument.instrumentClass);
    if (trade.brokerAccountId !== brokerAccountId) {
      ctx.deps.tradesRepo.patchPendingExecution(trade.id, { brokerAccountId });
    }

    const allocation = pipeline.result.state.brokerAllocation?.allocation;
    if (allocation?.warning === "over_allocated") {
      ctx.emitEvent(
        "WARN",
        trade.id,
        "Order exceeds allocation (warn-only mode); proceeding.",
        "orchestrator",
        context.cycleId,
      );
    }

    const { approved, approvalId: approvalIdForCapital } =
      await runApprovalAndCapital(ctx, context, trade, decision.output);
    if (!approved) {
      finishWithoutOpenPosition(ctx, "Trade not approved", "no_trade");
      return;
    }

    const brokerStep = await runOrchestratorStep(ctx, {
      cycleId: context.cycleId,
      stage: "broker_order",
      onRetry: retry,
      tradeId: trade.id,
      run: () => placeBrokerOrder(ctx, context, trade, riskOrder, latestQuote),
    });
    if (brokerStep.status === "paused") return;
    if (brokerStep.status === "failed") {
      if (!config.human_approval_required) {
        ctx.deps.capitalReservation.releaseOnFailure(trade.id);
      } else if (approvalIdForCapital) {
        ctx.deps.capitalReservation.releaseByApproval(approvalIdForCapital);
      }
      ctx.deps.tradesRepo.updateStatus(trade.id, "rejected", 0);
      ctx.deps.bus.emit("trade_closed", ctx.deps.tradesRepo.require(trade.id));
      finishWithoutOpenPosition(
        ctx,
        "Broker order failed",
        brokerStep.result.outcome,
      );
      return;
    }

    finalizeOpenedTrade(
      ctx,
      context,
      trade,
      brokerStep.value.brokerOrderId,
      brokerStep.value.filledAvgPrice,
      approvalIdForCapital,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.recordFailure({
      cycleId: context.cycleId,
      stage: "trade_cycle",
      outcome: "bug",
      level: "ERROR",
      code: error instanceof AppError ? error.code : "UNKNOWN_ERROR",
      message: `Trade cycle crashed: ${message}`,
      reasonCategory: "unexpected_bug",
    });
    ctx.emitEvent(
      "ERROR",
      context.trade?.id ?? null,
      `Trade cycle crashed: ${message}`,
      "orchestrator",
      context.cycleId,
    );
    ctx.clearNoInstrumentRetry();
    ctx.setSessionStatus("attention_required");
  }
}

export async function runTradeCycle(
  ctx: TradingCycleContext,
  instrument: ResolvedInstrument,
): Promise<void> {
  await executeTradeCycle(ctx, {
    kind: "trade",
    cycleId: crypto.randomUUID(),
    instrument,
    pipelineId: instrument.pipelineId,
    signalDeliveryId: instrument.signalDeliveryId,
    signalId: instrument.signalId,
  });
}
