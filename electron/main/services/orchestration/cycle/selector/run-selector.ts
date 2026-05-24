import type { InstrumentSelection } from "@/lib/schemas";
import type { SessionConfig, WorkspaceSession } from "@/lib/types";
import { MarketHoursService } from "../market-hours-service";
import type { TradingCycleContext } from "../trading-cycle-context";
import type { ResolvedInstrument } from "../types";

const marketHours = new MarketHoursService();

export async function runSelector(
  ctx: TradingCycleContext,
  session: WorkspaceSession,
  config: SessionConfig,
  cycleId: string,
): Promise<ResolvedInstrument[]> {
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
    input: {},
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

  const instruments: ResolvedInstrument[] = result.output.instruments.map(
    (row) => ({
      symbol: row.symbol,
      instrumentClass: row.instrumentClass,
      instrumentDisplayName: row.instrumentDisplayName,
      predictionOutcome: row.predictionOutcome ?? null,
      instrumentMetadataJson: row.instrumentMetadataJson ?? null,
      selectorEvidence: row.selectorEvidence ?? null,
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

  const { tradable, excluded } = marketHours.partitionByTradability(capped);
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
