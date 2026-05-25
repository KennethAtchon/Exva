import type { OrderRequest } from "../../../broker/adapters/broker-adapter";
import type { Trade } from "@/lib/types";
import type { TradeSignal } from "@electron/shared/ai/trade-signals";
import { runEngineForWorker } from "../../../pipeline/execution/engine-prompt-injector";
import type { InstrumentAnalysisResult } from "../../../pipeline/analysis/types";
import type { TradingCycleContext } from "../trading-cycle-context";
import type { TradeCycleContext } from "../types";
import { createOrderPolicyError } from "../../policy/outcome-classifier";
import { createOutcomeError } from "../runtime-outcome";
import { waitForApproval } from "./approval-flow";
import { buildOrderPolicyTask } from "./order-policy-task";
import { placeRoutedOrder } from "./order-placer";
import {
  persistTradeAiRuns,
  requirePipelineAiResults,
} from "./run-trade-pipeline";
import { createTradeFromDecision } from "./trade-record-builder";

export function persistPendingTradeFromPipeline(
  ctx: TradingCycleContext,
  context: TradeCycleContext,
  pipeline: InstrumentAnalysisResult,
): Trade {
  const config = ctx.getSessionConfig();
  const { technical, fundamental, review, decision } =
    requirePipelineAiResults(pipeline);

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
    persistTradeAiRuns(ctx, trade.id, [
      technical,
      fundamental,
      review,
      decision,
    ]);
    context.trade = trade;
  }

  if (!context.trade) {
    throw new Error("Trade should exist after pending trade persistence");
  }
  return context.trade;
}

export async function runApprovalAndCapital(
  ctx: TradingCycleContext,
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
    ctx.emitEvent(
      "WARN",
      trade.id,
      "Trade rejected by user",
      null,
      context.cycleId,
    );
    ctx.deps.bus.emit("trade_closed", rejected);
  }
  return { approved, approvalId };
}

export async function placeBrokerOrder(
  ctx: TradingCycleContext,
  context: TradeCycleContext,
  trade: Trade,
  riskOrder: OrderRequest,
  latestQuote?: { price: number; timestamp: string },
): Promise<{ brokerOrderId: string; filledAvgPrice: number }> {
  const config = ctx.getSessionConfig();
  const clientOrderId = `${context.cycleId}:${trade.id}`;
  const strategy = ctx.deps.strategyContextService.get(ctx.sessionId);
  const { adapter, brokerAccountId: resolvedBrokerAccountId } =
    await ctx.deps.brokerRouting.resolveAdapter(
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
    throw createOutcomeError(
      `Pre-placement quote fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      "BROKER_UNREACHABLE",
      {
        outcome: "transient",
        reasonCategory: "provider_transient",
        retryable: true,
      },
    );
  }

  const brokerSupportsClass = adapter.supportedInstrumentClasses.includes(
    context.instrument.instrumentClass,
  );
  const freshStats = ctx.deps.statsRepo.dashboardStats(
    ctx.sessionId,
    ctx.deps.sessionRepo.getStatus(ctx.sessionId),
    ctx.totalAllocatedUsd(),
    ctx.deps.sessionRepo.uptimeMin(ctx.sessionId),
    config.max_api_spend_usd,
  );
  const policyResult = runEngineForWorker<{
    allowed: boolean;
    reason?: string;
    gatesFailed?: string[];
  }>({
    phase: "decision",
    sessionId: ctx.sessionId,
    cycleId: context.cycleId,
    strategyContext: strategy,
    bindings: [],
    binding: { engine: "order-policy", kind: "policy", mode: "read" },
    task: buildOrderPolicyTask({
      sessionId: ctx.sessionId,
      cycleId: context.cycleId,
      tradeId: trade.id,
      brokerAccountId: resolvedBrokerAccountId,
      existingOrderCheck: (orderId: string, accountId: string) =>
        ctx.deps.tradesRepo.checkDuplicateClientOrder(accountId, orderId),
      sessionIsPaused: () => !ctx.runtimeIsActive(),
      config,
      stats: freshStats,
      order: riskOrder,
      confidence: trade.confidence_score ?? 0,
      side: trade.side,
      strategy,
      brokerSupportsClass,
      quoteSnapshot: latestQuote ?? undefined,
      placementQuoteSnapshot: placementQuote,
    }) as unknown as Record<string, unknown>,
  });
  if (!policyResult.allowed) {
    throw createOrderPolicyError(
      policyResult.reason ?? "Order blocked by policy gate",
      policyResult.gatesFailed ?? [],
    );
  }

  ctx.deps.tradesRepo.patchPendingExecution(trade.id, {
    client_order_id: clientOrderId,
  });
  const placed = await placeRoutedOrder(
    ctx,
    trade,
    context.instrument.instrumentClass,
    riskOrder,
    clientOrderId,
  );
  if (!placed) {
    throw createOutcomeError(
      "Instrument conflict or broker routing blocked order placement.",
      "VALIDATION_FAILED",
      {
        outcome: "no_trade",
        reasonCategory: "broker_allocation",
      },
    );
  }
  return placed;
}

export function finalizeOpenedTrade(
  ctx: TradingCycleContext,
  context: TradeCycleContext,
  trade: Trade,
  brokerOrderId: string,
  filledAvgPrice: number,
  approvalIdForCapital: string | null,
): void {
  const opened = ctx.deps.tradesRepo.markOpen(
    trade.id,
    brokerOrderId,
    filledAvgPrice,
  );
  if (approvalIdForCapital) {
    ctx.deps.capitalReservation.convertApprovalToOpenOrder(
      approvalIdForCapital,
      trade.id,
    );
  }
  ctx.deps.capitalReservation.convertOrderToPosition(trade.id);
  ctx.clearAttentionRequired();
  ctx.resetHardFailureStreak();
  ctx.emitEvent(
    "INFO",
    trade.id,
    `Placed ${trade.side} ${trade.instrumentSymbol} $${trade.position_size_usd} via broker.`,
    "broker",
    context.cycleId,
  );
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
    outcome: null,
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
