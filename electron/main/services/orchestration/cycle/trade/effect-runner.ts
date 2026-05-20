import { AppError } from "@electron/shared/infra/errors";
import type { OrderRequest } from "../../../broker/adapters/broker-adapter";
import type { Trade } from "@/lib/types";
import type { TradeSignal } from "@electron/shared/ai/pipeline-signals";
import { runEngineBinding } from "../../../ai/pipeline-runtime/execution/engine-context-runner";
import type { TradePipelineResult } from "../../../ai/pipeline-runtime/plan/cycle/types";
import type { OrchestratorContext } from "../orchestrator-context";
import type { TradeCycleContext } from "../types";
import { waitForApproval } from "./approval-flow";
import { placeRoutedOrder } from "./order-placer";
import { persistTradeAiRuns, requirePipelineAiResults } from "./run-trade-pipeline";
import { createTradeFromDecision } from "./trade-record-builder";

export function persistPendingTradeFromPipeline(
  ctx: OrchestratorContext,
  context: TradeCycleContext,
  pipeline: TradePipelineResult,
): Trade {
  const config = ctx.getSessionConfig();
  const { technical, fundamental, review, decision } = requirePipelineAiResults(pipeline);

  if (!context.trade) {
    const trade = createTradeFromDecision(
      ctx,
      context.instrument,
      config,
      decision.output,
      pipeline.totalAiCostUsd,
      review.output.recommendation,
    );
    ctx.deps.tradesRepo.insert(trade);
    persistTradeAiRuns(ctx, trade.id, [technical, fundamental, review, decision]);
    context.trade = trade;
  }

  return context.trade!;
}

export async function runApprovalAndCapital(
  ctx: OrchestratorContext,
  context: TradeCycleContext,
  trade: Trade,
  decisionOutput: TradeSignal,
): Promise<{ approved: boolean; approvalId: string | null }> {
  const config = ctx.getSessionConfig();

  if (!config.human_approval_required) {
    ctx.deps.capitalReservation.reserveForOrder({
      sessionId: ctx.sessionId,
      tradeId: trade.id,
      amountUsd: trade.position_size_usd,
    });
    return { approved: true, approvalId: null };
  }

  const { approved, approvalId } = await waitForApproval(
    ctx,
    trade,
    context.instrument.instrumentClass,
    decisionOutput,
    undefined,
  );
  if (!approved) {
    ctx.deps.capitalReservation.releaseByApproval(approvalId);
    const rejected = ctx.deps.tradesRepo.updateStatus(trade.id, "rejected", 0);
    ctx.emitEvent("WARN", trade.id, "Trade rejected by user", null, context.cycleId);
    ctx.deps.bus.emit("trade_closed", rejected);
  }
  return { approved, approvalId };
}

export async function placeBrokerOrder(
  ctx: OrchestratorContext,
  context: TradeCycleContext,
  trade: Trade,
  riskOrder: OrderRequest,
  latestQuote?: { price: number; timestamp: string },
): Promise<{ brokerOrderId: string; filledAvgPrice: number }> {
  const config = ctx.getSessionConfig();
  const clientOrderId = `${context.cycleId}:${trade.id}`;
  const strategy = ctx.deps.strategyContextService.get(ctx.sessionId);
  const { adapter, brokerAccountId: resolvedBrokerAccountId } = await ctx.deps.brokerRouting.resolveAdapter(
    ctx.sessionId,
    context.instrument.instrumentClass,
  );

  const wireSymbol = ctx.deps.instrumentNormalizer.toBrokerSymbol({
    symbol: context.instrument.symbol,
    instrumentClass: context.instrument.instrumentClass,
    brokerType: adapter.brokerType,
  });
  let placementQuote: { price: number; timestamp: string };
  try {
    const snap = await adapter.getMarketSnapshot(wireSymbol);
    placementQuote = { price: snap.price, timestamp: snap.timestamp };
  } catch (err) {
    throw new AppError(
      `Pre-placement quote fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      "VALIDATION_FAILED",
    );
  }

  const brokerSupportsClass = adapter.supportedInstrumentClasses.includes(context.instrument.instrumentClass);
  const freshStats = ctx.deps.statsRepo.dashboardStats(
    ctx.sessionId,
    ctx.deps.sessionRepo.getStatus(ctx.sessionId),
    ctx.totalAllocatedUsd(),
    ctx.deps.sessionRepo.uptimeMin(ctx.sessionId),
    config.max_api_spend_usd,
  );
  const policyResult = runEngineBinding<{ allowed: boolean; reason?: string }>({
    phase: "decision",
    sessionId: ctx.sessionId,
    cycleId: context.cycleId,
    strategyContext: strategy,
    bindings: [],
    binding: { engine: "order-policy", kind: "policy", mode: "read" },
    task: {
      sessionId: ctx.sessionId,
      cycleId: context.cycleId,
      tradeId: trade.id,
      brokerAccountId: resolvedBrokerAccountId,
      existingOrderCheck: (orderId: string, accountId: string) => ctx.deps.tradesRepo.checkDuplicateClientOrder(accountId, orderId),
      sessionIsPaused: () => !ctx.runtimeIsActive(),
      decisionRiskInput: {
        config,
        stats: freshStats,
        order: riskOrder,
        confidence: trade.confidence_score ?? 0,
        quoteSnapshot: latestQuote ?? undefined,
        placementQuoteSnapshot: placementQuote,
        side: trade.side,
        holdingStyle: strategy.timeframe.holdingStyle,
        exitPolicy: {
          stopLossPct: strategy.riskConfig.stopLossPct,
          atrStopMultiplier: strategy.riskConfig.atrStopMultiplier,
          takeProfitPct: strategy.riskConfig.takeProfitPct,
          maxHoldDays: strategy.timeframe.maxHoldDays,
        },
        strategyRules: { sideBias: strategy.rules.sideBias },
        brokerSupportsClass,
      },
    },
  });
  if (!policyResult.allowed) {
    throw new AppError(policyResult.reason ?? "Order blocked by policy gate", "VALIDATION_FAILED");
  }

  ctx.deps.tradesRepo.patchPendingExecution(trade.id, { client_order_id: clientOrderId });
  const placed = await placeRoutedOrder(ctx, trade, context.instrument.instrumentClass, riskOrder, clientOrderId);
  if (!placed) {
    throw new AppError("Instrument conflict or broker routing blocked order placement.", "VALIDATION_FAILED");
  }
  return placed;
}

export function finalizeOpenedTrade(
  ctx: OrchestratorContext,
  context: TradeCycleContext,
  trade: Trade,
  brokerOrderId: string,
  filledAvgPrice: number,
  approvalIdForCapital: string | null,
): void {
  const opened = ctx.deps.tradesRepo.markOpen(trade.id, brokerOrderId, filledAvgPrice);
  if (approvalIdForCapital) {
    ctx.deps.capitalReservation.convertApprovalToOpenOrder(approvalIdForCapital, trade.id);
  }
  ctx.deps.capitalReservation.convertOrderToPosition(trade.id);
  ctx.clearAttentionRequired();
  ctx.emitEvent("INFO", trade.id, `Placed ${trade.side} ${trade.instrumentSymbol} $${trade.position_size_usd} via broker.`, "broker", context.cycleId);
  ctx.deps.bus.emit("trade_opened", opened);
  ctx.deps.sessionExecutionStepsRepo.upsert({
    sessionId: ctx.sessionId,
    cycleId: context.cycleId,
    stage: "monitoring",
    status: "succeeded",
    attempt: 1,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    nextRetryAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    retryable: false,
  });
  ctx.emitEvent(
    "INFO",
    trade.id,
    `Trade opened ${trade.side} ${trade.instrumentSymbol}; session waiting for position to close before next cycle.`,
    "orchestrator",
    context.cycleId,
  );
}
