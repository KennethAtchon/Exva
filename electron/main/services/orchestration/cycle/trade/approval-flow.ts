import type { InstrumentClass, Trade } from "@/lib/types";
import type { TradeSignal } from "@electron/shared/ai/trade-signals";
import type { TradingCycleContext } from "../trading-cycle-context";

export function waitForApproval(
  ctx: TradingCycleContext,
  trade: Trade,
  instrumentClass: InstrumentClass,
  decisionOut: TradeSignal,
  riskNote: string | undefined,
): Promise<{ approved: boolean; approvalId: string }> {
  const resolvedBroker =
    trade.brokerAccountId ?? ctx.resolveBrokerAccountId(instrumentClass);
  if (trade.brokerAccountId == null) {
    ctx.deps.tradesRepo.patchPendingExecution(trade.id, {
      brokerAccountId: resolvedBroker,
    });
  }

  const sessionStrategy = ctx.deps.strategyContextService.get(
    ctx.sessionId,
  ).timeframe;
  // Approval row + capital reservation must commit together.
  const approval = ctx.deps.tradeApprovalsRepo.runInTransaction(() => {
    const pending = ctx.deps.tradeApprovalsRepo.createPending({
      sessionId: ctx.sessionId,
      tradeId: trade.id,
      brokerAccountId: resolvedBroker,
      instrumentSymbol: trade.instrumentSymbol,
      instrumentDisplayName: trade.instrumentDisplayName ?? null,
      predictionOutcome: trade.predictionOutcome ?? null,
      instrumentMetadataJson: trade.instrumentMetadataJson ?? null,
      instrumentClass,
      proposedSide: trade.side,
      proposedSizeUsd: trade.position_size_usd,
      decisionSummaryJson: JSON.stringify({
        confidence: trade.confidence_score,
        reasoning: decisionOut.reasoning,
        riskNote: riskNote ?? null,
        sessionHorizon: {
          primaryTradingTimeframe: sessionStrategy.primaryTradingTimeframe,
          holdingStyle: sessionStrategy.holdingStyle,
          targetHoldDays: sessionStrategy.targetHoldDays,
          maxHoldDays: sessionStrategy.maxHoldDays,
          timeframeNotes: sessionStrategy.timeframeNotes.trim() || undefined,
        },
      }),
    });
    ctx.deps.capitalReservation.reserveForApproval({
      sessionId: ctx.sessionId,
      approvalId: pending.id,
      amountUsd: trade.position_size_usd,
    });
    return pending;
  });

  ctx.deps.bus.emit("approval_required", {
    trade_id: trade.id,
    approval_id: approval.id,
    session_id: ctx.sessionId,
    instrumentSymbol: trade.instrumentSymbol,
    instrumentDisplayName: trade.instrumentDisplayName ?? undefined,
    predictionOutcome: trade.predictionOutcome ?? null,
    instrumentMetadataJson: trade.instrumentMetadataJson ?? null,
    side: trade.side,
    size_usd: trade.position_size_usd,
    confidence: trade.confidence_score ?? 0,
    reasoning: decisionOut.reasoning,
  });

  ctx.pendingApprovalIds.set(trade.id, approval.id);

  return new Promise((resolve) => {
    ctx.approvalCallbacks.set(trade.id, (approved) => {
      ctx.approvalCallbacks.delete(trade.id);
      ctx.pendingApprovalIds.delete(trade.id);
      resolve({ approved, approvalId: approval.id });
    });
  });
}

export function failRecheck(
  ctx: TradingCycleContext,
  tradeId: string,
  approvalId: string,
  message: string,
): void {
  const rejected = ctx.deps.capitalReservation.runInTransaction(() => {
    ctx.deps.capitalReservation.releaseByApproval(approvalId);
    return ctx.deps.tradesRepo.updateStatus(tradeId, "rejected", 0);
  });
  ctx.emitEvent("WARN", tradeId, message);
  ctx.deps.bus.emit("trade_closed", rejected);
}

export function resolveApproval(
  ctx: TradingCycleContext,
  tradeId: string,
  approved: boolean,
): boolean {
  const resolve = ctx.approvalCallbacks.get(tradeId);
  if (!resolve) return false;
  ctx.approvalCallbacks.delete(tradeId);
  resolve(approved);
  return true;
}

export function hasApprovalCallback(
  ctx: TradingCycleContext,
  tradeId: string,
): boolean {
  return ctx.approvalCallbacks.has(tradeId);
}
