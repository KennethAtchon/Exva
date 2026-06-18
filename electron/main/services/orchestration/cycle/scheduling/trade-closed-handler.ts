import { canScheduleAutonomousSelector } from "../../../session/session-trade-state";
import type { TradingCycleContext } from "../trading-cycle-context";

export function attachTradeClosedListener(
  ctx: TradingCycleContext,
  scheduleSelectorCycle: () => Promise<void>,
): void {
  if (ctx.unsubscribeTradeClosed) return;
  ctx.unsubscribeTradeClosed = ctx.deps.bus.on("trade_closed", (trade) => {
    if (trade.sessionId !== ctx.sessionId || trade.status !== "closed") return;
    if (ctx.deps.sessionRepo.getStatus(ctx.sessionId) === "monitoring_only") {
      return;
    }
    if (!ctx.runtimeIsActive()) return;
    if (ctx.cycleRestartInFlight) return;

    // One guard for every autonomous kickoff: a pipeline with no selector
    // workers (signal-driven) does not restart research after a trade closes —
    // it waits for the next delivery. Open-trade / capacity checks are folded
    // into the same predicate.
    if (!canScheduleAutonomousSelector(ctx)) return;

    ctx.cycleRestartInFlight = true;
    ctx.emitEvent(
      "INFO",
      trade.id,
      "Trade closed; session restarting research cycle.",
      "orchestrator",
    );
    if (ctx.stopped) {
      ctx.cycleRestartInFlight = false;
      return;
    }
    ctx.enqueueTask(scheduleSelectorCycle, (error) => {
      ctx.emitEvent(
        "ERROR",
        null,
        `Trade-closed cycle restart failed: ${error instanceof Error ? error.message : String(error)}`,
        "orchestrator",
      );
    });
    ctx.queue.onIdle().finally(() => {
      ctx.cycleRestartInFlight = false;
    });
  });
}

export function detachTradeClosedListener(ctx: TradingCycleContext): void {
  ctx.unsubscribeTradeClosed?.();
  ctx.unsubscribeTradeClosed = null;
}
