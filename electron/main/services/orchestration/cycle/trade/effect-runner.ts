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
import { adapterCapabilitiesOf } from "../../../broker/adapters/broker-adapter";
import { liftBrokerOrderV1ToV2 } from "../../../broker/order-contract-v2";
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
  const { technical, fundamental, review, decision } = requirePipelineAiResults(
    pipeline,
    context.pipelineId,
  );

  if (!context.trade) {
    const trade = createTradeFromDecision(
      ctx,
      context.instrument,
      decision.output,
      pipeline.totalAiCostUsd,
      review?.output.recommendation,
    );
    ctx.deps.tradesRepo.insert(trade);
    persistTradeAiRuns(
      ctx,
      trade.id,
      [technical, fundamental, review, decision].filter(
        (run): run is NonNullable<typeof run> => run != null,
      ),
    );
    context.trade = trade;
  }

  if (!context.trade) {
    throw new Error("Trade should exist after pending trade persistence");
  }
  return context.trade;
}

import { resolveMockToolContext } from "../../../pipeline/worker-tools/resolve-mock-tool-context";
import {
  computeSlippageBps,
  spreadPctToBps,
} from "@electron/shared/instruments/trade-exit-analytics";

type EntryQuoteSnapshot = {
  price: number;
  spreadPct?: number;
  timestamp: string;
};

async function isScriptedMockSession(
  ctx: TradingCycleContext,
): Promise<boolean> {
  const mock = await resolveMockToolContext({
    sessionId: ctx.sessionId,
    brokerRouting: ctx.deps.brokerRouting,
    brokerRegistry: ctx.deps.brokerRegistry,
  });
  return mock.isMockSession && mock.executionTier === "scripted";
}

export async function runApprovalAndCapital(
  ctx: TradingCycleContext,
  context: TradeCycleContext,
  trade: Trade,
  decisionOutput: TradeSignal,
): Promise<{ approved: boolean; approvalId: string | null }> {
  const riskConfig = ctx.getStrategyContext().riskConfig;
  const autoApprove =
    !riskConfig.humanApprovalRequired || (await isScriptedMockSession(ctx));

  if (autoApprove) {
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
  const strategy = ctx.getStrategyContext();
  const clientOrderId = `${context.cycleId}:${trade.id}`;
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
    ctx.deps.logger.error(
      { err, sessionId: ctx.sessionId, tradeId: trade.id, wireSymbol },
      "pre-placement market snapshot fetch failed",
    );
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
    strategy.riskConfig.maxAiSpendUsd,
  );
  const orderV2 = liftBrokerOrderV1ToV2({
    instrumentSymbol: wireSymbol,
    instrumentDisplayName: context.instrument.instrumentDisplayName,
    predictionOutcome: context.instrument.predictionOutcome,
    instrumentMetadataJson: context.instrument.instrumentMetadataJson,
    instrumentType: context.instrument.instrumentClass,
    side: riskOrder.side,
    sizeUsd: riskOrder.sizeUsd,
    clientOrderId,
  });
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
      riskConfig: strategy.riskConfig,
      stats: freshStats,
      order: riskOrder,
      confidence: trade.confidence_score ?? 0,
      side: trade.side,
      strategy,
      brokerSupportsClass,
      quoteSnapshot: latestQuote ?? undefined,
      placementQuoteSnapshot: placementQuote,
      orderV2,
      adapterCapabilities: adapterCapabilitiesOf(adapter),
    }) as unknown as Record<string, unknown>,
  });
  if (!policyResult.allowed) {
    ctx.deps.logger.warn(
      {
        sessionId: ctx.sessionId,
        tradeId: trade.id,
        reason: policyResult.reason,
        gatesFailed: policyResult.gatesFailed,
      },
      "order blocked by policy gate",
    );
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

function completeSignalDelivery(
  ctx: TradingCycleContext,
  context: TradeCycleContext,
  status: "traded" | "rejected" | "dropped",
  tradeId?: string | null,
  dropReason?: string | null,
): void {
  if (!context.signalDeliveryId || !context.signalId) return;
  const lifecycle = ctx.deps.signalDeliveryLifecycle;
  if (!lifecycle) return;
  lifecycle.complete(context.signalDeliveryId, {
    sessionId: ctx.sessionId,
    signalId: context.signalId,
    status,
    tradeId: tradeId ?? null,
    dropReason: dropReason ?? null,
  });
}

export function finalizeOpenedTrade(
  ctx: TradingCycleContext,
  context: TradeCycleContext,
  trade: Trade,
  brokerOrderId: string,
  filledAvgPrice: number,
  approvalIdForCapital: string | null,
  quoteSnapshot?: EntryQuoteSnapshot,
): void {
  const referencePrice =
    trade.entry_price ?? quoteSnapshot?.price ?? filledAvgPrice;
  const spreadAtEntryBps =
    quoteSnapshot?.spreadPct != null
      ? spreadPctToBps(quoteSnapshot.spreadPct)
      : null;
  const slippageBps =
    referencePrice > 0
      ? computeSlippageBps({
          side: trade.side as "BUY" | "SELL",
          referencePrice,
          filledPrice: filledAvgPrice,
        })
      : null;

  const opened = ctx.deps.tradesRepo.markOpen(
    trade.id,
    brokerOrderId,
    filledAvgPrice,
    { spreadAtEntryBps, slippageBps },
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
  completeSignalDelivery(ctx, context, "traded", trade.id);
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
