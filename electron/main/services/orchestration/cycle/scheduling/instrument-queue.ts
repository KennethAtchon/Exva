import type { TradingCycleContext } from "../trading-cycle-context";
import type { ResolvedInstrument } from "../types";
import { formatMinutesLabel } from "../utils";
import { scheduleCycleRefillAfterDelayIfIdle } from "./cycle-refill";

/** Node's setTimeout clamps delays above this; never schedule beyond it. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Choose the no-instrument retry delay. When the selector reported the cycle
 * was blocked purely by market hours, defer to the next open instead of the
 * fixed interval — but never retry *sooner* than the fixed interval, so a
 * near-immediate open still respects the configured pacing.
 */
function resolveNoInstrumentRetryMs(
  ctx: TradingCycleContext,
  fixedRetryMs: number,
): { retryMs: number; waitingForOpen: boolean } {
  const marketOpenAt = ctx.consumeMarketClosedRetryAt();
  if (marketOpenAt == null)
    return { retryMs: fixedRetryMs, waitingForOpen: false };

  const untilOpenMs = marketOpenAt - Date.now();
  if (untilOpenMs <= fixedRetryMs) {
    return { retryMs: fixedRetryMs, waitingForOpen: false };
  }
  return {
    retryMs: Math.min(untilOpenMs, MAX_TIMEOUT_MS),
    waitingForOpen: true,
  };
}

/** Render an ISO instant as a short America/New_York wall-clock for operators. */
function formatEtClock(iso: string): string {
  return `${new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  })} ET`;
}

export function handleResolvedInstruments(
  ctx: TradingCycleContext,
  instruments: ResolvedInstrument[],
  context: string,
  callbacks: {
    scheduleSelectorCycle: () => Promise<void>;
    enqueueTradeCycle: (instrument: ResolvedInstrument) => Promise<void>;
  },
): void {
  const { logger } = ctx.deps;

  if (ctx.stopped) {
    logger.info(
      {
        sessionId: ctx.sessionId,
        instrumentCount: instruments.length,
        context,
      },
      "orchestrator handoff skipped: runtime stopped",
    );
    return;
  }

  logger.info(
    {
      sessionId: ctx.sessionId,
      instrumentCount: instruments.length,
      symbols: instruments.map((row) => row.symbol),
      context,
    },
    "orchestrator selector handoff received",
  );

  if (instruments.length === 0) {
    const fixedRetryMs = ctx.getFailureRetryMinutes() * 60 * 1000;
    const { retryMs, waitingForOpen } = resolveNoInstrumentRetryMs(
      ctx,
      fixedRetryMs,
    );
    const retryAtIso = new Date(Date.now() + retryMs).toISOString();
    logger.warn(
      {
        sessionId: ctx.sessionId,
        context,
        retryMs,
        retryAt: retryAtIso,
        waitingForOpen,
        blockReason: waitingForOpen
          ? "market_closed_until_open"
          : "no_tradable_instruments_after_selector",
      },
      "orchestrator blocked: no tradable instruments; scheduling selector retry",
    );
    ctx.emitEvent(
      "INFO",
      null,
      waitingForOpen
        ? `${context}; market is closed. Waiting until the next open (${formatEtClock(retryAtIso)}) instead of re-polling.`
        : `${context}; no tradable instruments were selected. Re-evaluating in ${formatMinutesLabel(ctx.getFailureRetryMinutes())}.`,
      "orchestrator",
    );
    ctx.recordFailure({
      // Synthetic selector-cycle id — no trade cycle exists when the selector returns zero instruments.
      cycleId: crypto.randomUUID(),
      stage: "selector_cycle",
      outcome: "no_trade",
      level: "WARN",
      code: null,
      message: `${context}; no tradable instruments were selected.`,
      reasonCategory: "model_no_trade",
    });
    scheduleCycleRefillAfterDelayIfIdle(
      ctx,
      callbacks.scheduleSelectorCycle,
      "Scheduled selector retry complete",
      retryMs,
    );
    return;
  }

  ctx.clearNoInstrumentRetry();
  ctx.resetNoTradeSkipStreak();
  ctx.clearAttentionRequired();
  ctx.emitEvent(
    "INFO",
    null,
    `${context}; ${instruments.length} cycles enqueued.`,
    "orchestrator",
  );
  enqueueTradeCycles(ctx, callbacks.enqueueTradeCycle, instruments);
}

function enqueueTradeCycles(
  ctx: TradingCycleContext,
  enqueueTradeCycle: (instrument: ResolvedInstrument) => Promise<void>,
  instruments: ResolvedInstrument[],
): void {
  if (ctx.stopped) {
    ctx.deps.logger.info(
      {
        sessionId: ctx.sessionId,
        instrumentCount: instruments.length,
      },
      "orchestrator trade cycle enqueue skipped: runtime stopped",
    );
    return;
  }

  // If the runtime was paused while the selector cycle was in-flight, discard
  // the results rather than queuing them behind a paused queue. A fresh
  // selector cycle will run when the session is resumed.
  if (!ctx.runtimeIsActive()) {
    ctx.deps.logger.info(
      {
        sessionId: ctx.sessionId,
        instrumentCount: instruments.length,
      },
      "orchestrator trade cycle enqueue skipped: runtime paused",
    );
    return;
  }
  const uniqueInstruments = dedupeResolvedInstruments(instruments);
  if (uniqueInstruments.length < instruments.length) {
    ctx.deps.logger.info(
      {
        sessionId: ctx.sessionId,
        beforeDedup: instruments.length,
        afterDedup: uniqueInstruments.length,
      },
      "orchestrator deduplicated resolved instruments before enqueue",
    );
  }
  ctx.deps.logger.info(
    {
      sessionId: ctx.sessionId,
      instrumentCount: uniqueInstruments.length,
      symbols: uniqueInstruments.map((row) => row.symbol),
    },
    "orchestrator enqueueing trade cycles",
  );
  for (const instrument of uniqueInstruments) {
    ctx.enqueueTask(
      () => enqueueTradeCycle(instrument),
      (error) => {
        ctx.emitEvent(
          "ERROR",
          null,
          `Trade cycle failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
    );
  }
}

function dedupeResolvedInstruments(
  instruments: ResolvedInstrument[],
): ResolvedInstrument[] {
  const seen = new Set<string>();
  const unique: ResolvedInstrument[] = [];
  for (const instrument of instruments) {
    const key = `${instrument.instrumentClass}:${instrument.symbol.trim().toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(instrument);
  }
  return unique;
}
