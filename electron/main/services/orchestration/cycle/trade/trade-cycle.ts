import { AppError } from "@electron/shared/infra/errors";
import { CandidateValidationService } from "../../policy/candidate-validation-service";
import { OrderPolicyGate } from "../../policy/order-policy-gate";
import type { OrchestratorContext } from "../orchestrator-context";
import type { ResolvedInstrument, TradeCycleContext } from "../types";
import { sumAiPipelineCost } from "../utils";
import { runAiPipeline } from "./ai-pipeline";
import { waitForApproval } from "./approval-flow";
import { placeRoutedOrder } from "./order-placer";
import { createTradeFromDecision } from "./trade-record-builder";

export function enqueueTradeCycleRetry(
  ctx: OrchestratorContext,
  context: TradeCycleContext,
  execute: () => Promise<void>,
): void {
  if (!ctx.runtimeIsActive()) return;
  ctx.enqueueTask(execute, (error) => {
    ctx.emitEvent(
      "ERROR",
      null,
      `Scheduled trade-step retry failed: ${error instanceof Error ? error.message : String(error)}`,
      "orchestrator",
      context.cycleId,
    );
  });
}

export async function executeTradeCycle(ctx: OrchestratorContext, context: TradeCycleContext): Promise<void> {
  if (!ctx.runtimeIsActive()) return;
  ctx.cycleContexts.set(context.cycleId, context);
  ctx.deps.logger.debug(
    { sessionId: ctx.sessionId, instrumentSymbol: context.instrument.symbol, instrumentClass: context.instrument.instrumentClass },
    "trade cycle start",
  );

  const config = ctx.getSessionConfig();
  const stepRunner = ctx.getStepRunner(context.cycleId);
  const retry = () => enqueueTradeCycleRetry(ctx, context, () => executeTradeCycle(ctx, context));

  const candidateResult = await stepRunner.run(
    "candidate_validation",
    async () => {
      const { adapter } = await ctx.deps.brokerRouting.resolveAdapter(ctx.sessionId, context.instrument.instrumentClass);
      const wireSymbol = ctx.deps.instrumentNormalizer.toBrokerSymbol({
        symbol: context.instrument.symbol,
        instrumentClass: context.instrument.instrumentClass,
        brokerType: adapter.brokerType,
      });
      const quoteSnapshot = await adapter.getMarketSnapshot(wireSymbol);
      const strategy = ctx.deps.strategyContextService.get(ctx.sessionId);
      const session = ctx.deps.sessionRepo.requireById(ctx.sessionId);
      const sessionInstrumentClasses = ctx.getEffectiveInstrumentClasses(session);
      const cvResult = new CandidateValidationService().validate({
        sessionId: ctx.sessionId,
        cycleId: context.cycleId,
        instrument: {
          symbol: context.instrument.symbol,
          instrumentClass: context.instrument.instrumentClass,
          selectorEvidence: context.instrument.selectorEvidence ?? null,
        },
        sessionInstrumentClasses,
        sideBias: strategy.rules.sideBias,
        holdingStyle: strategy.timeframe.holdingStyle,
        selectorTrace: context.instrument.selectorTraces ?? [],
        quoteSnapshot,
      });
      if (!cvResult.allowed) {
        throw new AppError(`Candidate validation failed: ${cvResult.reasons.join("; ")}`, "VALIDATION_FAILED");
      }
      return quoteSnapshot;
    },
    { onRetry: retry },
  );
  if (await ctx.pauseIfRequested(context.cycleId)) return;
  if (!candidateResult.ok) {
    ctx.emitEvent(
      "WARN",
      null,
      `[candidate-validation] ${context.instrument.symbol}: ${candidateResult.errorMessage}`,
      "orchestrator",
      context.cycleId,
    );
    return;
  }
  const latestQuote = candidateResult.value;

  const pipeline = await runAiPipeline(ctx, context, config, stepRunner, retry);
  if (!pipeline) return;
  if (await ctx.pauseIfRequested(context.cycleId)) return;

  const { technical, fundamental, review, decision } = pipeline;
  const totalAiCostUsd = sumAiPipelineCost(pipeline);

  if (!context.trade) {
    const trade = createTradeFromDecision(ctx, context.instrument, config, decision.output, totalAiCostUsd, review.output.recommendation);
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

  if (!context.riskOrder) {
    const { riskConfig, timeframe } = ctx.deps.strategyContextService.get(ctx.sessionId);
    const riskResult = await stepRunner.run(
      "risk_gate",
      async () => {
        const stats = ctx.deps.statsRepo.dashboardStats(
          ctx.sessionId,
          ctx.deps.sessionRepo.getStatus(ctx.sessionId),
          ctx.totalAllocatedUsd(),
          ctx.deps.sessionRepo.uptimeMin(ctx.sessionId),
          config.max_api_spend_usd,
        );
        const risk = ctx.deps.riskEngine.validateDecision({
          config,
          stats,
          holdingStyle: timeframe.holdingStyle,
          order: {
            instrumentSymbol: trade.instrumentSymbol,
            instrumentDisplayName: trade.instrumentDisplayName ?? null,
            predictionOutcome: trade.predictionOutcome ?? null,
            instrumentMetadataJson: trade.instrumentMetadataJson ?? null,
            instrumentType: context.instrument.instrumentClass,
            side: trade.side,
            sizeUsd: trade.position_size_usd,
          },
          confidence: trade.confidence_score ?? 0,
          riskPolicy: {
            waitForOpenThreshold: riskConfig.waitForOpenThreshold,
            maxExposureUsd: context.instrument.instrumentClass === "prediction_market" ? riskConfig.maxExposureUsd : null,
          },
        });
        if (!risk.allowed || !risk.value) {
          throw new AppError(risk.reason ?? "Trade rejected by risk engine", "VALIDATION_FAILED");
        }
        return risk.value;
      },
      { onRetry: retry },
    );
    if (await ctx.pauseIfRequested(context.cycleId)) return;
    if (!riskResult.ok) {
      ctx.deps.tradesRepo.updateStatus(trade.id, "rejected", 0);
      ctx.handleStepFailure("risk_gate", context.cycleId, riskResult, trade.id);
      return;
    }
    context.riskOrder = riskResult.value;
  }

  const riskOrder = context.riskOrder;
  if (!riskOrder) {
    throw new AppError("Internal error: riskOrder missing after risk gate", "VALIDATION_FAILED");
  }

  const brokerAccountId = ctx.resolveBrokerAccountId(context.instrument.instrumentClass);
  if (trade.brokerAccountId !== brokerAccountId) {
    ctx.deps.tradesRepo.patchPendingExecution(trade.id, { brokerAccountId });
  }

  const allocationResult = ctx.deps.brokerAllocationGate.checkOrderFits(brokerAccountId, ctx.sessionId, riskOrder.sizeUsd);
  if (!allocationResult.ok) {
    ctx.deps.tradesRepo.updateStatus(trade.id, "rejected", 0);
    ctx.emitEvent("WARN", trade.id, allocationResult.reason, "orchestrator", context.cycleId);
    ctx.deps.bus.emit("trade_closed", ctx.deps.tradesRepo.require(trade.id));
    return;
  }
  if (allocationResult.warning === "over_allocated") {
    ctx.emitEvent("WARN", trade.id, "Order exceeds allocation (warn-only mode); proceeding.", "orchestrator", context.cycleId);
  }

  const conflictResult = ctx.deps.brokerAllocationGate.checkInstrumentConflict(
    brokerAccountId,
    context.instrument.symbol,
    ctx.sessionId,
  );
  if (!conflictResult.ok) {
    ctx.deps.tradesRepo.updateStatus(trade.id, "rejected", 0);
    ctx.emitEvent("WARN", trade.id, conflictResult.reason, "orchestrator", context.cycleId);
    ctx.deps.bus.emit("trade_closed", ctx.deps.tradesRepo.require(trade.id));
    return;
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

  const brokerResult = await stepRunner.run(
    "broker_order",
    async () => {
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
      const policyResult = new OrderPolicyGate().evaluate({
        sessionId: ctx.sessionId,
        cycleId: context.cycleId,
        tradeId: trade.id,
        brokerAccountId: resolvedBrokerAccountId,
        existingOrderCheck: (orderId, accountId) => ctx.deps.tradesRepo.checkDuplicateClientOrder(accountId, orderId),
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
    { onRetry: retry },
  );
  if (await ctx.pauseIfRequested(context.cycleId)) return;
  if (!brokerResult.ok) {
    if (!config.human_approval_required) {
      ctx.deps.capitalReservation.releaseOnFailure(trade.id);
    } else if (approvalIdForCapital) {
      ctx.deps.capitalReservation.releaseByApproval(approvalIdForCapital);
    }
    ctx.deps.tradesRepo.updateStatus(trade.id, "rejected", 0);
    ctx.handleStepFailure("broker_order", context.cycleId, brokerResult, trade.id);
    ctx.deps.bus.emit("trade_closed", ctx.deps.tradesRepo.require(trade.id));
    return;
  }

  const opened = ctx.deps.tradesRepo.markOpen(trade.id, brokerResult.value.brokerOrderId, brokerResult.value.filledAvgPrice);
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
