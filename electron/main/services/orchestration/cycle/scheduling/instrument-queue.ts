import type { TradingCycleContext } from "../trading-cycle-context";
import type { ResolvedInstrument } from "../types";
import { formatMinutesLabel } from "../utils";
import { scheduleCycleRefillAfterDelayIfIdle } from "./cycle-refill";

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
    const retryMinutes = ctx.getFailureRetryMinutes();
    const retryMs = retryMinutes * 60 * 1000;
    logger.warn(
      {
        sessionId: ctx.sessionId,
        context,
        retryMinutes,
        retryAt: new Date(Date.now() + retryMs).toISOString(),
        blockReason: "no_tradable_instruments_after_selector",
      },
      "orchestrator blocked: no tradable instruments; scheduling selector retry",
    );
    ctx.emitEvent(
      "INFO",
      null,
      `${context}; no tradable instruments were selected. Re-evaluating in ${formatMinutesLabel(retryMinutes)}.`,
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
