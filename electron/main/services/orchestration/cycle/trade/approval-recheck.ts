import type { ApprovalRecheckInput } from "../../../session";
import type { InstrumentClass } from "@/lib/types";
import { OrderPolicyGate } from "../../policy/order-policy-gate";
import type { OrchestratorContext } from "../orchestrator-context";
import type { TradeCycleContext } from "../types";
import { sumAiPipelineCost } from "../utils";
import { runAiPipeline } from "./ai-pipeline";
import { enqueueTradeCycleRetry, executeTradeCycle } from "./trade-cycle";
import { failRecheck } from "./approval-flow";
import { placeRoutedOrder } from "./order-placer";
import { buildTradeFromDecision } from "./trade-record-builder";

export async function runApprovalRecheck(ctx: OrchestratorContext, input: ApprovalRecheckInput): Promise<void> {
  if (!ctx.runtimeIsActive()) return;

  const approval = ctx.deps.tradeApprovalsRepo.require(input.approvalId);
  const trade = ctx.deps.tradesRepo.require(approval.tradeId);
  if (trade.status !== "pending") return;

  const config = ctx.getSessionConfig();
  const stats = ctx.deps.statsRepo.dashboardStats(
    ctx.sessionId,
    ctx.deps.sessionRepo.getStatus(ctx.sessionId),
    ctx.totalAllocatedUsd(),
    ctx.deps.sessionRepo.uptimeMin(ctx.sessionId),
    config.max_api_spend_usd,
  );

  const cycleId = crypto.randomUUID();
  const context: TradeCycleContext = {
    kind: "trade",
    cycleId,
    instrument: {
      symbol: trade.instrumentSymbol,
      instrumentClass: trade.instrumentType,
      instrumentDisplayName: trade.instrumentDisplayName ?? undefined,
      predictionOutcome: trade.predictionOutcome ?? null,
      instrumentMetadataJson: trade.instrumentMetadataJson ?? null,
    },
  };
  ctx.cycleContexts.set(cycleId, context);
  const pipeline = await runAiPipeline(ctx, context, config, ctx.getStepRunner(cycleId), () =>
    enqueueTradeCycleRetry(ctx, context, () => executeTradeCycle(ctx, context)),
  );
  if (!pipeline) return;

  const { technical, fundamental, review, decision } = pipeline;
  const totalAiCostUsd = sumAiPipelineCost(pipeline);

  for (const result of [technical, fundamental, review, decision]) {
    ctx.deps.agentRunsRepo.insert({ ...result.run, session_id: ctx.sessionId, trade_id: trade.id });
    ctx.deps.agentMessagesRepo.insert({ ...result.message, session_id: ctx.sessionId, trade_id: trade.id });
  }
  ctx.deps.tradesRepo.patchAiCost(trade.id, totalAiCostUsd);

  const fresh = decision.output;
  if (fresh.action === "skip") {
    failRecheck(ctx, trade.id, approval.id, "Fresh decision is skip; not placing order.");
    return;
  }

  const nextTrade = buildTradeFromDecision(
    ctx,
    trade.id,
    {
      symbol: trade.instrumentSymbol,
      instrumentClass: trade.instrumentType,
      instrumentDisplayName: trade.instrumentDisplayName ?? undefined,
      predictionOutcome: trade.predictionOutcome ?? null,
      instrumentMetadataJson: trade.instrumentMetadataJson ?? null,
    },
    config,
    fresh,
    totalAiCostUsd,
    review.output.recommendation,
  );
  ctx.deps.tradesRepo.patchPendingExecution(trade.id, {
    side: nextTrade.side,
    entry_price: nextTrade.entry_price,
    position_size_usd: nextTrade.position_size_usd,
    stop_loss_price: nextTrade.stop_loss_price,
    take_profit_price: nextTrade.take_profit_price,
    execution_strategy: nextTrade.execution_strategy,
    confidence_score: nextTrade.confidence_score,
    brokerAccountId: nextTrade.brokerAccountId,
  });
  const updated = ctx.deps.tradesRepo.require(trade.id);

  const riskConfig = ctx.deps.strategyContextService.get(ctx.sessionId).riskConfig;
  const risk = ctx.deps.riskEngine.validateDecision({
    config,
    stats,
    order: {
      instrumentSymbol: updated.instrumentSymbol,
      instrumentDisplayName: updated.instrumentDisplayName ?? null,
      predictionOutcome: updated.predictionOutcome ?? null,
      instrumentMetadataJson: updated.instrumentMetadataJson ?? null,
      instrumentType: input.instrumentClass,
      side: updated.side,
      sizeUsd: updated.position_size_usd,
    },
    confidence: updated.confidence_score ?? 0,
    riskPolicy: {
      waitForOpenThreshold: riskConfig.waitForOpenThreshold,
      maxExposureUsd: input.instrumentClass === "prediction_market" ? riskConfig.maxExposureUsd : null,
    },
  });

  if (!risk.allowed || !risk.value) {
    failRecheck(ctx, trade.id, approval.id, risk.reason ?? "Fresh risk check rejected the trade.");
    return;
  }

  ctx.deps.capitalReservation.updateReservedAmountForApproval(approval.id, risk.value.sizeUsd);

  const recheckBrokerAccountId = updated.brokerAccountId ?? ctx.resolveBrokerAccountId(input.instrumentClass as InstrumentClass);
  if (updated.brokerAccountId !== recheckBrokerAccountId) {
    ctx.deps.tradesRepo.patchPendingExecution(updated.id, { brokerAccountId: recheckBrokerAccountId });
  }
  const recheckAllocation = ctx.deps.brokerAllocationGate.checkOrderFits(recheckBrokerAccountId, ctx.sessionId, risk.value.sizeUsd);
  if (!recheckAllocation.ok) {
    failRecheck(ctx, trade.id, approval.id, recheckAllocation.reason);
    return;
  }
  if (recheckAllocation.warning === "over_allocated") {
    ctx.emitEvent("WARN", trade.id, "Order exceeds allocation (warn-only mode); proceeding.", "orchestrator", cycleId);
  }
  const recheckConflict = ctx.deps.brokerAllocationGate.checkInstrumentConflict(
    recheckBrokerAccountId,
    updated.instrumentSymbol,
    ctx.sessionId,
  );
  if (!recheckConflict.ok) {
    failRecheck(ctx, trade.id, approval.id, recheckConflict.reason);
    return;
  }

  const recheckClientOrderId = `${cycleId}:${trade.id}`;
  const strategy = ctx.deps.strategyContextService.get(ctx.sessionId);
  const recheckPolicy = new OrderPolicyGate().evaluate({
    sessionId: ctx.sessionId,
    cycleId,
    tradeId: trade.id,
    brokerAccountId: recheckBrokerAccountId,
    existingOrderCheck: (orderId, accountId) => ctx.deps.tradesRepo.checkDuplicateClientOrder(accountId, orderId),
    sessionIsPaused: () => !ctx.runtimeIsActive(),
    decisionRiskInput: {
      config,
      stats,
      order: risk.value,
      confidence: updated.confidence_score ?? 0,
      side: updated.side,
      holdingStyle: strategy.timeframe.holdingStyle,
      exitPolicy: {
        stopLossPct: strategy.riskConfig.stopLossPct,
        atrStopMultiplier: strategy.riskConfig.atrStopMultiplier,
        takeProfitPct: strategy.riskConfig.takeProfitPct,
        maxHoldDays: strategy.timeframe.maxHoldDays,
      },
      strategyRules: { sideBias: strategy.rules.sideBias },
      brokerSupportsClass: true,
    },
  });
  if (!recheckPolicy.allowed) {
    failRecheck(ctx, trade.id, approval.id, recheckPolicy.reason ?? "Approval recheck blocked by policy gate.");
    return;
  }

  const placed = await placeRoutedOrder(ctx, updated, input.instrumentClass, risk.value, recheckClientOrderId);
  if (!placed) {
    failRecheck(ctx, trade.id, approval.id, "Instrument conflict or broker routing blocked order placement.");
    return;
  }
  const opened = ctx.deps.tradesRepo.markOpen(trade.id, placed.brokerOrderId, placed.filledAvgPrice);
  ctx.deps.capitalReservation.convertApprovalToOpenOrder(approval.id, trade.id);
  ctx.deps.capitalReservation.convertOrderToPosition(trade.id);
  ctx.emitEvent("INFO", trade.id, `Placed ${updated.side} ${updated.instrumentSymbol} $${updated.position_size_usd} via broker (post-approval recheck).`, "broker");
  ctx.deps.bus.emit("trade_opened", opened);
  ctx.emitEvent(
    "INFO",
    trade.id,
    `Trade opened ${updated.side} ${updated.instrumentSymbol}; session waiting for position to close before next cycle.`,
    "orchestrator",
  );
}
