import type { InstrumentSelection } from "@/lib/schemas";
import type { WorkspaceSession } from "@/lib/types";
import type { SessionStrategyContext } from "@electron/shared/domain";
import { resolvePipelineIdForExperience } from "../../../../experiences";
import { resolveMockToolContext } from "../../../pipeline/worker-tools/resolve-mock-tool-context";
import { MarketHoursService } from "../market-hours-service";
import type { TradingCycleContext } from "../trading-cycle-context";
import type { ResolvedInstrument, SelectorCycleContext } from "../types";

const marketHours = new MarketHoursService();

async function shouldSkipMockStockTimeFilters(
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
  strategyContext: SessionStrategyContext,
  selectorContext: Pick<SelectorCycleContext, "cycleId" | "signalTrigger">,
): Promise<ResolvedInstrument[]> {
  const { cycleId, signalTrigger } = selectorContext;
  const { logger } = ctx.deps;
  const { maxConcurrentTrades, offHoursTrading } = strategyContext.riskConfig;

  logger.info(
    {
      sessionId: ctx.sessionId,
      cycleId,
      maxConcurrentTrades,
    },
    "selector orchestrator step starting pipeline run",
  );

  // Pre-AI EDGAR gates (Solution 02 WS7) — reject before paid model spend.
  if (
    signalTrigger?.sourceType === "edgar_8k" &&
    ctx.deps.edgarScreening &&
    signalTrigger.payloadJson
  ) {
    const payload = signalTrigger.payloadJson as Record<string, unknown>;
    const items = Array.isArray(payload.items)
      ? payload.items.map(String)
      : typeof payload.itemCodes === "string"
        ? payload.itemCodes.split(",").map((s) => s.trim())
        : [];
    const screen = ctx.deps.edgarScreening.screen({
      identity: {
        cik: String(payload.cik ?? ""),
        accession: String(
          signalTrigger.accessionNumber ?? payload.accession ?? "",
        ),
        filingUrl: String(
          signalTrigger.documentUrl ?? payload.filingUrl ?? "",
        ),
        acceptedAt: String(
          payload.acceptedAt ?? payload.filedAt ?? new Date().toISOString(),
        ),
        form: String(payload.form ?? "8-K"),
        items,
        ticker: signalTrigger.ticker ?? null,
        companyName: signalTrigger.companyName ?? null,
      },
      market: null,
    });
    if (!screen.ok) {
      logger.info(
        {
          sessionId: ctx.sessionId,
          cycleId,
          gate: screen.gate,
          reason: screen.reason,
        },
        "EDGAR candidate rejected before AI",
      );
      ctx.deps.cycleFunnel?.record({
        cycleId,
        sessionId: ctx.sessionId,
        inputId: signalTrigger.deliveryId ?? null,
        originKind: "strategy",
        terminalStage: "signal",
        outcome: "rejected",
        reasonCode: `EDGAR_${screen.gate}`.toUpperCase(),
        detailJson: JSON.stringify({ gate: screen.gate, reason: screen.reason }),
        occurredAt: new Date().toISOString(),
      });
      if (signalTrigger.deliveryId && ctx.deps.signalDeliveryLifecycle) {
        ctx.deps.signalDeliveryLifecycle.complete(signalTrigger.deliveryId, {
          sessionId: ctx.sessionId,
          signalId: signalTrigger.signalId,
          status: "rejected",
          dropReason: `edgar_${screen.gate}`,
        });
      }
      return [];
    }
  }

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

  const pipelineId = resolvePipelineIdForExperience(session.experienceId);

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

  const capped = instruments.slice(0, maxConcurrentTrades);
  if (capped.length < instruments.length) {
    logger.info(
      {
        sessionId: ctx.sessionId,
        cycleId,
        beforeCap: instruments.length,
        afterCap: capped.length,
        maxConcurrentTrades,
        droppedSymbols: instruments
          .slice(maxConcurrentTrades)
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

  const skipMockStockTimeFilters = await shouldSkipMockStockTimeFilters(ctx);
  const { tradable, excluded } = marketHours.partitionByTradability(
    capped,
    new Date(),
    {
      skipWeekendFilter: skipMockStockTimeFilters,
      skipExchangeHoursFilter: skipMockStockTimeFilters,
      offHoursTrading,
    },
  );
  // Reset any prior market-open wake time; only a fresh all-filtered result
  // below should re-arm it, so a later genuine no-trade cycle never inherits a
  // stale deferral.
  ctx.setMarketClosedRetryAt(null);
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
    // All accepted instruments were filtered purely by market hours. Enter
    // dormancy until the next open (Solution 05 P2-3) instead of burning
    // retries that only produce expected skips.
    const nextOpen = marketHours.nextTradableAt(excluded, new Date(), {
      offHoursTrading,
    });
    if (nextOpen && typeof ctx.enterMarketClosedDormancy === "function") {
      ctx.enterMarketClosedDormancy(nextOpen);
    } else {
      ctx.setMarketClosedRetryAt(nextOpen ? nextOpen.getTime() : null);
    }
    logger.warn(
      {
        sessionId: ctx.sessionId,
        cycleId,
        pipelineAcceptedCount: capped.length,
        blockReason: "all_instruments_filtered_by_market_hours",
        excluded,
        nextMarketOpenAt: nextOpen ? nextOpen.toISOString() : null,
      },
      "selector returning no tradable instruments; trade cycles will not be enqueued",
    );
  } else if (tradable.length > 0) {    logger.info(
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
