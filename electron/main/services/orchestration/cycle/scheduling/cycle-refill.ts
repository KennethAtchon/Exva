import type { TradingCycleContext } from "../trading-cycle-context";

export type ScheduleSelectorCycleFn = (label: string) => Promise<void>;

function hasOpenTradeCapacity(ctx: TradingCycleContext): boolean {
  const config = ctx.getSessionConfig();
  const openTrades = ctx.deps.tradesRepo.listOpenAndPending(ctx.sessionId);
  return openTrades.length < config.max_concurrent_trades;
}

export function scheduleCycleRefillIfIdle(
  ctx: TradingCycleContext,
  scheduleSelectorCycle: ScheduleSelectorCycleFn,
  label: string,
): void {
  if (ctx.stopped || !ctx.runtimeIsActive()) return;
  if (ctx.cycleRestartInFlight) return;
  if (!hasOpenTradeCapacity(ctx)) return;

  void ctx.queue.onIdle().then(() => {
    if (ctx.stopped || !ctx.runtimeIsActive()) return;
    if (ctx.cycleRestartInFlight) return;
    if (ctx.queue.pending > 0 || ctx.queue.size > 0) return;
    if (!hasOpenTradeCapacity(ctx)) return;

    ctx.cycleRestartInFlight = true;
    ctx.emitEvent(
      "INFO",
      null,
      `${label}; scheduling selector research cycle.`,
      "orchestrator",
    );
    ctx.queue
      .add(() => scheduleSelectorCycle(label))
      .catch((error) => {
        ctx.emitEvent(
          "ERROR",
          null,
          `No-trade cycle refill failed: ${error instanceof Error ? error.message : String(error)}`,
          "orchestrator",
        );
      })
      .finally(() => {
        ctx.cycleRestartInFlight = false;
      });
  });
}
