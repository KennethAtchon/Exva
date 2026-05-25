import { canScheduleSelector } from "../../../session/session-trade-state";
import type { TradingCycleContext } from "../trading-cycle-context";

export type ScheduleSelectorCycleFn = (label: string) => Promise<void>;

export function scheduleCycleRefillIfIdle(
  ctx: TradingCycleContext,
  scheduleSelectorCycle: ScheduleSelectorCycleFn,
  label: string,
): void {
  if (ctx.deps.sessionRepo.getStatus(ctx.sessionId) === "attention_required") {
    return;
  }
  if (ctx.stopped || !ctx.runtimeIsActive()) return;
  if (ctx.cycleRestartInFlight) return;
  if (!canScheduleSelector(ctx)) return;

  void ctx.queue.onIdle().then(() => {
    if (ctx.stopped || !ctx.runtimeIsActive()) return;
    if (ctx.cycleRestartInFlight) return;
    if (ctx.queue.pending > 0 || ctx.queue.size > 0) return;
    if (!canScheduleSelector(ctx)) return;

    ctx.cycleRestartInFlight = true;
    ctx.emitEvent(
      "INFO",
      null,
      `${label}; scheduling selector research cycle.`,
      "orchestrator",
    );
    ctx.enqueueTask(
      () => scheduleSelectorCycle(label),
      (error) => {
        ctx.emitEvent(
          "ERROR",
          null,
          `No-trade cycle refill failed: ${error instanceof Error ? error.message : String(error)}`,
          "orchestrator",
        );
      },
    );
    ctx.queue.onIdle().finally(() => {
      ctx.cycleRestartInFlight = false;
    });
  });
}

export function scheduleCycleRefillAfterDelayIfIdle(
  ctx: TradingCycleContext,
  scheduleSelectorCycle: ScheduleSelectorCycleFn,
  label: string,
  retryMs: number,
): void {
  if (ctx.deps.sessionRepo.getStatus(ctx.sessionId) === "attention_required") {
    return;
  }
  if (ctx.noInstrumentRetryTimer) {
    ctx.deps.logger.info(
      { sessionId: ctx.sessionId },
      "orchestrator retry timer already scheduled; skipping duplicate",
    );
    return;
  }

  const retryAt = new Date(Date.now() + retryMs).toISOString();
  ctx.deps.logger.info(
    { sessionId: ctx.sessionId, retryMs, retryAt, label },
    "orchestrator retry timer scheduled",
  );
  ctx.noInstrumentRetryTimer = setTimeout(() => {
    ctx.noInstrumentRetryTimer = null;
    if (
      ctx.deps.sessionRepo.getStatus(ctx.sessionId) === "attention_required"
    ) {
      return;
    }
    if (!ctx.runtimeIsActive()) return;
    scheduleCycleRefillIfIdle(ctx, scheduleSelectorCycle, label);
  }, retryMs);
}
