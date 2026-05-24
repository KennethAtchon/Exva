import type { ExvaEventName } from "@electron/shared/ipc/channels";
import type { EventBus, ExvaEventMap } from "./event-bus";
import type { Logger } from "./log";

/**
 * Mirrors EventBus emissions into structured pino logs so operator-facing
 * events are visible in log files, not only in the UI event stream.
 */
export function attachEventBusObserver(
  bus: EventBus,
  logger: Logger,
): () => void {
  const scopeLogger = logger.child({ scope: "event-bus" });
  const unsubscribers: Array<() => void> = [];

  function observe<K extends ExvaEventName>(
    name: K,
    handler: (payload: ExvaEventMap[K]) => void,
  ): void {
    unsubscribers.push(bus.on(name, handler));
  }

  observe("agent_event", (event) => {
    const level = event.level ?? "INFO";
    const logFn =
      level === "ERROR"
        ? scopeLogger.error.bind(scopeLogger)
        : level === "WARN"
          ? scopeLogger.warn.bind(scopeLogger)
          : level === "DEBUG"
            ? scopeLogger.debug.bind(scopeLogger)
            : scopeLogger.info.bind(scopeLogger);
    logFn(
      {
        eventName: "agent_event",
        eventId: event.id,
        sessionId: event.session_id,
        tradeId: event.trade_id,
        cycleId: event.cycle_id,
        agentType: event.agent_type,
        level,
      },
      event.message,
    );
  });

  observe("research_phase_started", (payload) => {
    scopeLogger.info(
      { eventName: "research_phase_started", ...payload },
      "research phase started",
    );
  });

  observe("research_phase_step", (payload) => {
    scopeLogger.info(
      { eventName: "research_phase_step", ...payload },
      payload.message,
    );
  });

  observe("research_phase_complete", (payload) => {
    scopeLogger.info(
      { eventName: "research_phase_complete", ...payload },
      "research phase complete",
    );
  });

  observe("research_phase_failed", (payload) => {
    scopeLogger.error(
      { eventName: "research_phase_failed", ...payload },
      "research phase failed",
    );
  });

  observe("step:started", (payload) => {
    scopeLogger.info(
      { eventName: "step:started", ...payload },
      "execution step started",
    );
  });

  observe("step:succeeded", (payload) => {
    scopeLogger.info(
      { eventName: "step:succeeded", ...payload },
      "execution step succeeded",
    );
  });

  observe("step:failed", (payload) => {
    scopeLogger.warn(
      { eventName: "step:failed", ...payload },
      "execution step failed",
    );
  });

  observe("step:retrying", (payload) => {
    scopeLogger.info(
      { eventName: "step:retrying", ...payload },
      "execution step retry scheduled",
    );
  });

  observe("session_status_changed", (payload) => {
    scopeLogger.info(
      { eventName: "session_status_changed", ...payload },
      "session status changed",
    );
  });

  observe("selector_run_completed", (payload) => {
    scopeLogger.info(
      { eventName: "selector_run_completed", ...payload },
      "selector run completed",
    );
  });

  observe("trade_opened", (trade) => {
    scopeLogger.info(
      {
        eventName: "trade_opened",
        sessionId: trade.sessionId,
        tradeId: trade.id,
        symbol: trade.instrumentSymbol,
      },
      "trade opened",
    );
  });

  observe("trade_closed", (trade) => {
    scopeLogger.info(
      {
        eventName: "trade_closed",
        sessionId: trade.sessionId,
        tradeId: trade.id,
        symbol: trade.instrumentSymbol,
        status: trade.status,
      },
      "trade closed",
    );
  });

  observe("approval_required", (payload) => {
    scopeLogger.info(
      {
        eventName: "approval_required",
        tradeId: payload.tradeId,
        symbol: payload.instrumentSymbol,
      },
      "trade approval required",
    );
  });

  observe("approval_resolved", (payload) => {
    scopeLogger.info(
      { eventName: "approval_resolved", ...payload },
      "trade approval resolved",
    );
  });

  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}
