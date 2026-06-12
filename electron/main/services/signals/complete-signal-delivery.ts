import type { TradingCycleContext } from "../orchestration/cycle/trading-cycle-context";
import type { TradeCycleContext } from "../orchestration/cycle/types";
import type { TerminalDeliveryStatus } from "./signal-delivery-lifecycle";

/** Central helper — complete a signal delivery at any trade-cycle terminal point. */
export function completeSignalDeliveryFromContext(
  ctx: TradingCycleContext,
  context: Pick<TradeCycleContext, "signalDeliveryId" | "signalId">,
  status: TerminalDeliveryStatus,
  options?: { tradeId?: string | null; dropReason?: string | null },
): void {
  if (!context.signalDeliveryId || !context.signalId) return;
  ctx.deps.signalDeliveryLifecycle?.complete(context.signalDeliveryId, {
    sessionId: ctx.sessionId,
    signalId: context.signalId,
    status,
    tradeId: options?.tradeId ?? null,
    dropReason: options?.dropReason ?? null,
  });
}
