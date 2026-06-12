import type { InstrumentSelection } from "@/lib/schemas";
import type { SessionConfig, WorkspaceSession } from "@/lib/types";
import { resolvePipelineIdForSource } from "../../../pipeline/implementations/registry/pipeline-router";
import { resolveMockToolContext } from "../../../pipeline/worker-tools/resolve-mock-tool-context";
import { MarketHoursService } from "../market-hours-service";
import type { TradingCycleContext } from "../trading-cycle-context";
import type { ResolvedInstrument, SelectorCycleContext } from "../types";

const marketHours = new MarketHoursService();

async function shouldSkipWeekendFilter(
  ctx: TradingCycleContext,
): Promise<boolean> {
  const mock = await resolveMockToolContext({
    sessionId: ctx.sessionId,
    brokerRouting: ctx.deps.brokerRouting,
    brokerRegistry: ctx.deps.brokerRegistry,
  });
  return mock.isMockSession;
}

export async function runSelector(
  ctx: TradingCycleContext,
  session: WorkspaceSession,
  config: SessionConfig,
  selectorContext: Pick<SelectorCycleContext, "cycleId" | "signalTrigger">,
): Promise<ResolvedInstrument[]> {
  const { cycleId, signalTrigger } = selectorContext;
  const { logger } = ctx.deps;

  logger.info(
    {
      sessionId: ctx.sessionId,
      cycleId,
      maxConcurrentTrades: config.max_concurrent_trades,
    },
    "selector orchestrator step starting pipeline run",
  );

  const result = (await ctx.deps.ai.runPlan("selector", {
    sessionId: session.id,
    cycleId,
    input: {
      failureHistory: ctx.getFailureHistory(),
      nextEligibleRetryAt: ctx.getNearestRetryAt(),
      signalTrigger,
    },
  })) as import("../../../pipeline/phases/types").AIPhaseResult<InstrumentSelection>;

  logger.info(
    {
      sessionId: ctx.sessionId,
      cycleId,
      source: result.source,
      pipelineInstrumentCount: result.output.instruments.length,
      acceptedCount: result.output.diagnostics?.acceptedCount ?? null,
      rejectedCount: result.output.diagnostics?.rejected?.length ?? null,
    },
    "selector pipeline run complete",
  );

  const pipelineId = resolvePipelineIdForSource(signalTrigger?.sourceType);

  const signalDeliveryId = signalTrigger?.deliveryId;
  const instruments: ResolvedInstrument[] = result.output.instruments.map(
    (row) => ({
      symbol: row.symbol,
      instrumentClass: row.instrumentClass,
      instrumentDisplayName: row.instrumentDisplayName,
      predictionOutcome: row.predictionOutcome ?? null,
      instrumentMetadataJson: row.instrumentMetadataJson ?? null,
      selectorEvidence: row.selectorEvidence ?? null,
      recentFailureHistory: ctx.getFailureHistoryForInstrument(row.symbol),
      pipelineId,
      signalDeliveryId,
      signalId: signalTrigger?.signalId,
    }),
  );

  const capped = instruments.slice(0, config.max_concurrent_trades);
  if (capped.length < instruments.length) {
    logger.info(
      {
        sessionId: ctx.sessionId,
        cycleId,
        beforeCap: instruments.length,
        afterCap: capped.length,
        maxConcurrentTrades: config.max_concurrent_trades,
        droppedSymbols: instruments
          .slice(config.max_concurrent_trades)
          .map((row) => row.symbol),
      },
      "selector capped instrument list to max concurrent trades",
    );
  }

  if (result.source === "ai_picker") {
    ctx.emitEvent(
      "INFO",
      null,
      `[stage:selector] pipeline complete; ${capped.length} instrument(s) accepted`,
      "orchestrator",
      cycleId,
    );
    ctx.deps.bus.emit("research_phase_step", {
      sessionId: ctx.sessionId,
      phase: "selector",
      cycleId,
      message: `[stage:selector] pipeline complete; ${capped.length} instrument(s) accepted`,
    });
  }

  if (result.source === "ai_picker" && capped.length > 0) {
    ctx.emitEvent(
      "INFO",
      null,
      `[stage:selector] submission count=${capped.length}`,
      "orchestrator",
      cycleId,
    );
    ctx.deps.bus.emit("research_phase_step", {
      sessionId: ctx.sessionId,
      phase: "selector",
      cycleId,
      message: `Selector chose ${capped.length} instruments`,
    });
  }

  const diagnostics = result.output.diagnostics;
  if (
    result.source === "ai_picker" &&
    capped.length === 0 &&
    diagnostics &&
    diagnostics.rejected.length > 0
  ) {
    const summary = diagnostics.rejected
      .slice(0, 5)
      .map((row) => `${row.symbol}: ${row.reasons[0] ?? "rejected"}`)
      .join("; ");
    ctx.emitEvent(
      "WARN",
      null,
      `[stage:selector] no instruments accepted; ${diagnostics.rejected.length} rejected (${summary})`,
      "orchestrator",
      cycleId,
    );
    ctx.deps.bus.emit("research_phase_step", {
      sessionId: ctx.sessionId,
      phase: "selector",
      cycleId,
      message: `Selector rejected all candidates: ${summary}`,
    });
  }

  const skipWeekendFilter = await shouldSkipWeekendFilter(ctx);
  const { tradable, excluded } = marketHours.partitionByTradability(
    capped,
    new Date(),
    { skipWeekendFilter },
  );
  if (excluded.length > 0) {
    logger.warn(
      {
        sessionId: ctx.sessionId,
        cycleId,
        beforeFilterCount: capped.length,
        afterFilterCount: tradable.length,
        excluded,
        keptSymbols: tradable.map((row) => row.symbol),
      },
      "selector market-hours filter excluded instruments; orchestrator handoff may be blocked",
    );
    ctx.emitEvent(
      "WARN",
      null,
      `[stage:selector] ${excluded.length} instrument(s) excluded by market-hours filter (${excluded.map((row) => `${row.symbol}:${row.reason}`).join(", ")})`,
      "orchestrator",
      cycleId,
    );
  }

  if (
    tradable.length === 0 &&
    signalDeliveryId &&
    signalTrigger?.signalId &&
    ctx.deps.signalDeliveryLifecycle
  ) {
    ctx.deps.signalDeliveryLifecycle.complete(signalDeliveryId, {
      sessionId: ctx.sessionId,
      signalId: signalTrigger.signalId,
      status: capped.length === 0 ? "rejected" : "dropped",
      dropReason:
        capped.length === 0
          ? "selector_no_instruments"
          : "market_hours_filtered",
    });
  }

  if (tradable.length === 0 && capped.length > 0) {
    logger.warn(
      {
        sessionId: ctx.sessionId,
        cycleId,
        pipelineAcceptedCount: capped.length,
        blockReason: "all_instruments_filtered_by_market_hours",
        excluded,
      },
      "selector returning no tradable instruments; trade cycles will not be enqueued",
    );
  } else if (tradable.length > 0) {
    logger.info(
      {
        sessionId: ctx.sessionId,
        cycleId,
        tradableCount: tradable.length,
        symbols: tradable.map((row) => row.symbol),
      },
      "selector returning tradable instruments for orchestrator handoff",
    );
  }

  return tradable;
}
