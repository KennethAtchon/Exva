import type { ApprovalRecheckInput } from "../../../session";
import type {
  TradeCycleInstrument,
  InstrumentAnalysisResult,
} from "../../../pipeline/analysis/types";
import { runEngineForWorker } from "../../../pipeline/execution/engine-prompt-injector";
import type { TradingCycleContext } from "../trading-cycle-context";
import { failRecheck } from "./approval-flow";
import { buildOrderPolicyTask } from "./order-policy-task";
import { placeRoutedOrder } from "./order-placer";
import { runPostDecisionGates } from "./post-decision-gates";
import { buildTradeFromDecision } from "./trade-record-builder";

export async function runApprovalRecheck(
  ctx: TradingCycleContext,
  input: ApprovalRecheckInput,
): Promise<void> {
  if (!ctx.runtimeIsActive()) return;

  const approval = ctx.deps.tradeApprovalsRepo.require(input.approvalId);
  const trade = ctx.deps.tradesRepo.require(approval.tradeId);
  if (trade.status !== "pending") return;

  const config = ctx.getSessionConfig();
  const cycleId = crypto.randomUUID();
  const instrument: TradeCycleInstrument = {
    symbol: trade.instrumentSymbol,
    instrumentClass: trade.instrumentType,
    instrumentDisplayName: trade.instrumentDisplayName ?? undefined,
    predictionOutcome: trade.predictionOutcome ?? null,
    instrumentMetadataJson: trade.instrumentMetadataJson ?? null,
  };
  ctx.cycleContexts.set(cycleId, { kind: "trade", cycleId, instrument });

  const session = ctx.deps.sessionRepo.requireById(ctx.sessionId);
  const pipeline = (await ctx.deps.ai.runPlan("default-trade-cycle", {
    sessionId: ctx.sessionId,
    cycleId,
    tradeId: trade.id,
    instrument,
    sessionConfig: config,
    instrumentClasses: ctx.getEffectiveInstrumentClasses(session),
    lastStageId: "decision",
  })) as InstrumentAnalysisResult;

  const { technical, fundamental, review, decision } = pipeline.state;
  if (!technical || !fundamental || !review || !decision) {
    failRecheck(
      ctx,
      trade.id,
      approval.id,
      "Fresh AI pipeline did not complete.",
    );
    return;
  }

  for (const result of [technical, fundamental, review, decision]) {
    ctx.deps.agentRunsRepo.insert({
      ...result.run,
      session_id: ctx.sessionId,
      trade_id: trade.id,
    });
    ctx.deps.agentMessagesRepo.insert({
      ...result.message,
      session_id: ctx.sessionId,
      trade_id: trade.id,
    });
  }
  ctx.deps.tradesRepo.patchAiCost(trade.id, pipeline.totalAiCostUsd);

  const fresh = decision.output;
  if (fresh.action === "skip") {
    failRecheck(
      ctx,
      trade.id,
      approval.id,
      "Fresh decision is skip; not placing order.",
    );
    return;
  }

  let gateState;
  try {
    gateState = await runPostDecisionGates(
      ctx,
      instrument,
      pipeline.state,
      cycleId,
      trade.id,
    );
  } catch (err) {
    failRecheck(
      ctx,
      trade.id,
      approval.id,
      err instanceof Error ? err.message : "Post-decision gate rejected trade.",
    );
    return;
  }
  const riskOrder = gateState.riskOrder;
  if (!riskOrder) {
    failRecheck(
      ctx,
      trade.id,
      approval.id,
      "Approval recheck could not resolve a risk-sized order.",
    );
    return;
  }

  const nextTrade = buildTradeFromDecision(
    ctx,
    trade.id,
    instrument,
    config,
    fresh,
    pipeline.totalAiCostUsd,
    review.output.recommendation,
  );
  ctx.deps.tradesRepo.patchPendingExecution(trade.id, {
    side: nextTrade.side,
    entry_price: nextTrade.entry_price,
    position_size_usd: riskOrder.sizeUsd,
    stop_loss_price: nextTrade.stop_loss_price,
    take_profit_price: nextTrade.take_profit_price,
    execution_strategy: nextTrade.execution_strategy,
    confidence_score: nextTrade.confidence_score,
    brokerAccountId: gateState.brokerAccountId ?? nextTrade.brokerAccountId,
  });
  ctx.deps.capitalReservation.updateReservedAmountForApproval(
    approval.id,
    riskOrder.sizeUsd,
  );

  if (gateState.brokerAllocation?.allocation.warning === "over_allocated") {
    ctx.emitEvent(
      "WARN",
      trade.id,
      "Order exceeds allocation (warn-only mode); proceeding.",
      "orchestrator",
      cycleId,
    );
  }

  const strategy = ctx.deps.strategyContextService.get(ctx.sessionId);
  const recheckClientOrderId = `${cycleId}:${trade.id}`;
  const recheckBrokerAccountId =
    gateState.brokerAccountId ??
    nextTrade.brokerAccountId ??
    trade.brokerAccountId;
  if (!recheckBrokerAccountId) {
    failRecheck(
      ctx,
      trade.id,
      approval.id,
      "Approval recheck could not resolve a broker account.",
    );
    return;
  }
  const recheckPolicy = runEngineForWorker<{
    allowed: boolean;
    reason?: string;
  }>({
    phase: "decision",
    sessionId: ctx.sessionId,
    cycleId,
    strategyContext: strategy,
    bindings: [],
    binding: { engine: "order-policy", kind: "policy", mode: "read" },
    task: buildOrderPolicyTask({
      sessionId: ctx.sessionId,
      cycleId,
      tradeId: trade.id,
      brokerAccountId: recheckBrokerAccountId,
      existingOrderCheck: (orderId: string, accountId: string) =>
        ctx.deps.tradesRepo.checkDuplicateClientOrder(accountId, orderId),
      sessionIsPaused: () => !ctx.runtimeIsActive(),
      config,
      stats: ctx.deps.statsRepo.dashboardStats(
        ctx.sessionId,
        ctx.deps.sessionRepo.getStatus(ctx.sessionId),
        ctx.totalAllocatedUsd(),
        ctx.deps.sessionRepo.uptimeMin(ctx.sessionId),
        config.max_api_spend_usd,
      ),
      order: riskOrder,
      confidence: fresh.confidence,
      side: nextTrade.side,
      strategy,
      brokerSupportsClass: true,
    }) as unknown as Record<string, unknown>,
  });
  if (!recheckPolicy.allowed) {
    failRecheck(
      ctx,
      trade.id,
      approval.id,
      recheckPolicy.reason ?? "Approval recheck blocked by policy gate.",
    );
    return;
  }

  const updated = ctx.deps.tradesRepo.require(trade.id);
  const placed = await placeRoutedOrder(
    ctx,
    updated,
    input.instrumentClass,
    riskOrder,
    recheckClientOrderId,
  );
  if (!placed) {
    failRecheck(
      ctx,
      trade.id,
      approval.id,
      "Instrument conflict or broker routing blocked order placement.",
    );
    return;
  }
  const opened = ctx.deps.tradesRepo.markOpen(
    trade.id,
    placed.brokerOrderId,
    placed.filledAvgPrice,
  );
  ctx.deps.capitalReservation.convertApprovalToOpenOrder(approval.id, trade.id);
  ctx.deps.capitalReservation.convertOrderToPosition(trade.id);
  ctx.emitEvent(
    "INFO",
    trade.id,
    `Placed ${nextTrade.side} ${trade.instrumentSymbol} $${riskOrder.sizeUsd} via broker (post-approval recheck).`,
    "broker",
  );
  ctx.deps.bus.emit("trade_opened", opened);
  ctx.emitEvent(
    "INFO",
    trade.id,
    `Trade opened ${nextTrade.side} ${trade.instrumentSymbol}; session waiting for position to close before next cycle.`,
    "orchestrator",
  );
}
