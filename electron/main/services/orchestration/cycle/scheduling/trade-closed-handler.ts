import type { OrchestratorContext } from "../orchestrator-context";

export function attachTradeClosedListener(
  ctx: OrchestratorContext,
  scheduleSelectorCycle: () => Promise<void>,
): void {
  if (ctx.unsubscribeTradeClosed) return;
  ctx.unsubscribeTradeClosed = ctx.deps.bus.on("trade_closed", (trade) => {
    if (trade.sessionId !== ctx.sessionId || trade.status !== "closed") return;
    if (!ctx.runtimeIsActive()) return;
    if (ctx.cycleRestartInFlight) return;
    ctx.cycleRestartInFlight = true;
    ctx.emitEvent(
      "INFO",
      trade.id,
      "Trade closed; session restarting research cycle.",
      "orchestrator",
    );
    ctx.queue
      .add(scheduleSelectorCycle)
      .catch((error) => {
        ctx.emitEvent(
          "ERROR",
          null,
          `Trade-closed cycle restart failed: ${error instanceof Error ? error.message : String(error)}`,
          "orchestrator",
        );
      })
      .finally(() => {
        ctx.cycleRestartInFlight = false;
      });
  });
}

export function detachTradeClosedListener(ctx: OrchestratorContext): void {
  ctx.unsubscribeTradeClosed?.();
  ctx.unsubscribeTradeClosed = null;
}
