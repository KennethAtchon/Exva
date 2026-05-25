import { countOpenTrades } from "../../../session/session-trade-state";
import type { TradingCycleContext } from "../trading-cycle-context";

export function attachTradeClosedListener(
  ctx: TradingCycleContext,
  scheduleSelectorCycle: () => Promise<void>,
): void {
  if (ctx.unsubscribeTradeClosed) return;
  ctx.unsubscribeTradeClosed = ctx.deps.bus.on("trade_closed", (trade) => {
    if (trade.sessionId !== ctx.sessionId || trade.status !== "closed") return;
    if (!ctx.runtimeIsActive()) return;
    if (ctx.cycleRestartInFlight) return;

    const remainingOpenTrades = countOpenTrades(
      ctx.deps.tradesRepo,
      ctx.sessionId,
    );
    if (remainingOpenTrades > 0) {
      ctx.deps.logger.info(
        { sessionId: ctx.sessionId, remainingOpenTrades, closedTradeId: trade.id },
        "selector restart blocked after trade_closed: open trades remain",
      );
      return;
    }

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
