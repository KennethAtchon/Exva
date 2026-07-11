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
import { completeSignalDeliveryFromContext } from "../../../signals/complete-signal-delivery";
import { captureSignalObservation } from "./observation-capture";
import { runWithProviderCallScopeAsync } from "../../../infra/provider-call-log";

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
    await runWithProviderCallScopeAsync(
      {
        sessionId: ctx.sessionId,
        cycleId: context.cycleId,
        tradeId: context.trade?.id ?? null,
      },
      async () => {
        const config = ctx.getSessionConfig();
        const retry = tradeCycleRetry(ctx, context);

        const pipeline = await runTradePipeline(ctx, context, retry);
        if (pipeline.status === "paused") return;
        if (pipeline.status === "failed") {
          const dropReason =
            pipeline.stage === "risk_gate"
              ? "risk_gate_rejected"
              : pipeline.stage === "broker_order"
                ? "order_policy_rejected"
                : `${pipeline.stage}_failed`;
          completeSignalDeliveryFromContext(ctx, context, "rejected", {
            dropReason,
          });
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

        // P1/P3: capture every evaluation as a point-in-time observation,
        // including skips — the dataset spine for label-driven research.
        captureSignalObservation(
          ctx,
          context,
          decision,
          latestQuote?.price ?? null,
          latestQuote?.timestamp ?? new Date().toISOString(),
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
            reasonCategory: isConfidenceNoTrade
              ? "risk_gate"
              : "model_no_trade",
          });
          ctx.emitEvent(
            isConfidenceNoTrade ? "WARN" : "INFO",
            trade.id,
            isConfidenceNoTrade
              ? `No trade for ${trade.instrumentSymbol}: ${decision.output.reasoning}`
              : `No trade decision for ${trade.instrumentSymbol}: ${decision.output.reasoning}`,
            "orchestrator",
            context.cycleId,
          );
          completeSignalDeliveryFromContext(ctx, context, "rejected", {
            dropReason: isConfidenceNoTrade
              ? "confidence_below_threshold"
              : decision.output.reasoning.includes("stale")
                ? "stale"
                : "decision_skip",
          });
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
          ctx.deps.tradesRepo.patchPendingExecution(trade.id, {
            brokerAccountId,
          });
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
          completeSignalDeliveryFromContext(ctx, context, "rejected", {
            dropReason: "approval_rejected",
          });
          finishWithoutOpenPosition(ctx, "Trade not approved", "no_trade");
          return;
        }

        const brokerStep = await runOrchestratorStep(ctx, {
          cycleId: context.cycleId,
          stage: "broker_order",
          onRetry: retry,
          tradeId: trade.id,
          run: () =>
            placeBrokerOrder(ctx, context, trade, riskOrder, latestQuote),
        });
        if (brokerStep.status === "paused") return;
        if (brokerStep.status === "failed") {
          if (!config.human_approval_required) {
            ctx.deps.capitalReservation.releaseOnFailure(trade.id);
          } else if (approvalIdForCapital) {
            ctx.deps.capitalReservation.releaseByApproval(approvalIdForCapital);
          }
          ctx.deps.tradesRepo.updateStatus(trade.id, "rejected", 0);
          ctx.deps.bus.emit(
            "trade_closed",
            ctx.deps.tradesRepo.require(trade.id),
          );
          completeSignalDeliveryFromContext(ctx, context, "rejected", {
            dropReason: "broker_order_failed",
          });
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
          latestQuote,
        );
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.deps.logger.error(
      {
        err: error,
        sessionId: ctx.sessionId,
        cycleId: context.cycleId,
        tradeId: context.trade?.id ?? null,
      },
      "trade cycle crashed",
    );
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
