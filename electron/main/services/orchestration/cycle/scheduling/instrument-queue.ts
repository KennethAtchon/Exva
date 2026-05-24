import type { TradingCycleContext } from "../trading-cycle-context";
import type { ResolvedInstrument } from "../types";
import { formatMinutesLabel } from "../utils";

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
    const retryMinutes = ctx.getNoInstrumentRetryMinutes();
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
    scheduleNoInstrumentRetry(ctx, callbacks.scheduleSelectorCycle, retryMs);
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

function scheduleNoInstrumentRetry(
  ctx: TradingCycleContext,
  scheduleSelectorCycle: () => Promise<void>,
  retryMs: number,
): void {
  if (ctx.noInstrumentRetryTimer) {
    ctx.deps.logger.info(
      { sessionId: ctx.sessionId },
      "orchestrator no-instrument retry already scheduled; skipping duplicate",
    );
    return;
  }
  ctx.deps.logger.info(
    {
      sessionId: ctx.sessionId,
      retryMs,
      retryAt: new Date(Date.now() + retryMs).toISOString(),
    },
    "orchestrator no-instrument retry timer scheduled",
  );
  ctx.noInstrumentRetryTimer = setTimeout(() => {
    ctx.noInstrumentRetryTimer = null;
    ctx.deps.logger.info(
      { sessionId: ctx.sessionId },
      "orchestrator no-instrument retry timer fired",
    );
    if (!ctx.runtimeIsActive()) {
      ctx.deps.logger.info(
        { sessionId: ctx.sessionId },
        "orchestrator no-instrument retry skipped: runtime not active",
      );
      return;
    }
    ctx.enqueueTask(scheduleSelectorCycle, (error) => {
      ctx.emitEvent(
        "ERROR",
        null,
        `Scheduled selector retry failed: ${error instanceof Error ? error.message : String(error)}`,
        "orchestrator",
      );
    });
  }, retryMs);
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
  ctx.deps.logger.info(
    {
      sessionId: ctx.sessionId,
      instrumentCount: instruments.length,
      symbols: instruments.map((row) => row.symbol),
    },
    "orchestrator enqueueing trade cycles",
  );
  for (const instrument of instruments) {
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
