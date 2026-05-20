import { AppError } from "@electron/shared/infra/errors";
import { runEngineBinding } from "../../../ai/pipeline-runtime/execution/engine-context-runner";
import type { OrchestratorContext } from "../orchestrator-context";
import { enqueueCycleTask, runOrchestratorStep } from "../orchestrator-step";
import type { ResolvedInstrument, TradeCycleContext } from "../types";
import { waitForApproval } from "./approval-flow";
import { placeRoutedOrder } from "./order-placer";
import { applyTradePipelineToContext, runTradePipeline } from "./run-trade-pipeline";
import { createTradeFromDecision } from "./trade-record-builder";

function tradeCycleRetry(ctx: OrchestratorContext, context: TradeCycleContext): () => void {
  return () =>
    enqueueCycleTask(ctx, context.cycleId, "Scheduled trade-step retry failed", () => executeTradeCycle(ctx, context));
}

export async function executeTradeCycle(ctx: OrchestratorContext, context: TradeCycleContext): Promise<void> {
  if (!ctx.runtimeIsActive()) return;
  ctx.cycleContexts.set(context.cycleId, context);
  ctx.deps.logger.debug(
    { sessionId: ctx.sessionId, instrumentSymbol: context.instrument.symbol, instrumentClass: context.instrument.instrumentClass },
    "trade cycle start",
  );

  const config = ctx.getSessionConfig();
  const retry = tradeCycleRetry(ctx, context);

  const pipeline = await runTradePipeline(ctx, context, retry);
  if (!pipeline) return;

  applyTradePipelineToContext(context, pipeline);
  const latestQuote = pipeline.state.quoteSnapshot;
  const { technical, fundamental, review, decision } = pipeline.state;
  if (!technical || !fundamental || !review || !decision) {
    throw new AppError("Internal error: trade pipeline returned incomplete AI results.", "VALIDATION_FAILED");
  }

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
    for (const result of [technical, fundamental, review, decision]) {
      ctx.deps.agentRunsRepo.insert({ ...result.run, session_id: ctx.sessionId, trade_id: trade.id });
      ctx.deps.agentMessagesRepo.insert({ ...result.message, session_id: ctx.sessionId, trade_id: trade.id });
    }
    context.trade = trade;
  }

  const trade = context.trade;
  if (decision.output.action === "skip") {
    ctx.clearAttentionRequired();
    ctx.emitEvent("INFO", trade.id, `No trade decision for ${trade.instrumentSymbol}; cycle complete.`, "orchestrator", context.cycleId);
    return;
  }

  const riskOrder = context.riskOrder ?? pipeline.state.riskOrder;
  if (!riskOrder) {
    throw new AppError("Internal error: riskOrder missing after trade pipeline", "VALIDATION_FAILED");
  }
  context.riskOrder = riskOrder;

  const brokerAccountId = pipeline.state.brokerAccountId ?? ctx.resolveBrokerAccountId(context.instrument.instrumentClass);
  if (trade.brokerAccountId !== brokerAccountId) {
    ctx.deps.tradesRepo.patchPendingExecution(trade.id, { brokerAccountId });
  }

  const allocation = pipeline.state.brokerAllocation?.allocation;
  if (allocation?.warning === "over_allocated") {
    ctx.emitEvent("WARN", trade.id, "Order exceeds allocation (warn-only mode); proceeding.", "orchestrator", context.cycleId);
  }

  let approvalIdForCapital: string | null = null;
  if (config.human_approval_required) {
    const { approved, approvalId } = await waitForApproval(ctx, trade, context.instrument.instrumentClass, decision.output, undefined);
    approvalIdForCapital = approvalId;
    if (!approved) {
      ctx.deps.capitalReservation.releaseByApproval(approvalId);
      const rejected = ctx.deps.tradesRepo.updateStatus(trade.id, "rejected", 0);
      ctx.emitEvent("WARN", trade.id, "Trade rejected by user", null, context.cycleId);
      ctx.deps.bus.emit("trade_closed", rejected);
      return;
    }
  }

  if (!config.human_approval_required) {
    ctx.deps.capitalReservation.reserveForOrder({
      sessionId: ctx.sessionId,
      tradeId: trade.id,
      amountUsd: trade.position_size_usd,
    });
  }

  const brokerStep = await runOrchestratorStep(ctx, {
    cycleId: context.cycleId,
    stage: "broker_order",
    onRetry: retry,
    tradeId: trade.id,
    run: async () => {
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
    },
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
    return;
  }

  const opened = ctx.deps.tradesRepo.markOpen(trade.id, brokerStep.value.brokerOrderId, brokerStep.value.filledAvgPrice);
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

export async function runTradeCycle(ctx: OrchestratorContext, instrument: ResolvedInstrument): Promise<void> {
  await executeTradeCycle(ctx, { kind: "trade", cycleId: crypto.randomUUID(), instrument });
}
