import { AppError } from "@electron/shared/infra/errors";
import type { TradingCycleContext } from "../trading-cycle-context";
import { enqueueCycleTask, runOrchestratorStep } from "../orchestrator-step";
import type { ResolvedInstrument, TradeCycleContext } from "../types";
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

  const config = ctx.getSessionConfig();
  const retry = tradeCycleRetry(ctx, context);

  const pipeline = await runTradePipeline(ctx, context, retry);
  if (!pipeline) return;

  applyTradePipelineToContext(context, pipeline);
  const latestQuote = pipeline.state.quoteSnapshot;
  const { decision } = requirePipelineAiResults(pipeline);
  const trade = persistPendingTradeFromPipeline(ctx, context, pipeline);

  if (decision.output.action === "skip") {
    ctx.clearAttentionRequired();
    ctx.emitEvent(
      "INFO",
      trade.id,
      `No trade decision for ${trade.instrumentSymbol}; cycle complete.`,
      "orchestrator",
      context.cycleId,
    );
    return;
  }

  const riskOrder = context.riskOrder ?? pipeline.state.riskOrder;
  if (!riskOrder) {
    throw new AppError(
      "Internal error: riskOrder missing after trade pipeline",
      "VALIDATION_FAILED",
    );
  }
  context.riskOrder = riskOrder;

  const brokerAccountId =
    pipeline.state.brokerAccountId ??
    ctx.resolveBrokerAccountId(context.instrument.instrumentClass);
  if (trade.brokerAccountId !== brokerAccountId) {
    ctx.deps.tradesRepo.patchPendingExecution(trade.id, { brokerAccountId });
  }

  const allocation = pipeline.state.brokerAllocation?.allocation;
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
  if (!approved) return;

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
}

export async function runTradeCycle(
  ctx: TradingCycleContext,
  instrument: ResolvedInstrument,
): Promise<void> {
  await executeTradeCycle(ctx, {
    kind: "trade",
    cycleId: crypto.randomUUID(),
    instrument,
  });
}
