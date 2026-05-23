import type { OrchestratorContext } from "../orchestrator-context";
import type { ResolvedInstrument } from "../types";
import { formatMinutesLabel } from "../utils";

export function handleResolvedInstruments(
  ctx: OrchestratorContext,
  instruments: ResolvedInstrument[],
  context: string,
  callbacks: {
    scheduleSelectorCycle: () => Promise<void>;
    enqueueTradeCycle: (instrument: ResolvedInstrument) => Promise<void>;
  },
): void {
  if (ctx.stopped) return;
  if (instruments.length === 0) {
    const retryMinutes = ctx.getNoInstrumentRetryMinutes();
    const retryMs = retryMinutes * 60 * 1000;
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
  ctx: OrchestratorContext,
  scheduleSelectorCycle: () => Promise<void>,
  retryMs: number,
): void {
  if (ctx.noInstrumentRetryTimer) return;
  ctx.noInstrumentRetryTimer = setTimeout(() => {
    ctx.noInstrumentRetryTimer = null;
    if (!ctx.runtimeIsActive()) return;
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
  ctx: OrchestratorContext,
  enqueueTradeCycle: (instrument: ResolvedInstrument) => Promise<void>,
  instruments: ResolvedInstrument[],
): void {
  if (ctx.stopped) return;
  ctx.deps.logger.info(
    { sessionId: ctx.sessionId, instrumentCount: instruments.length },
    "enqueueing trade cycles",
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
