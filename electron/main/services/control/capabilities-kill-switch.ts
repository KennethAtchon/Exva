import { defineCapability } from "./capability";
import {
  CONFIRM_CLASS,
  emptyInputSchema,
  OPEN_TRADE_STATUSES,
  sessionRefSchema,
} from "./capabilities-shared";
import { resolveSession } from "./resolve-session";

export const getKillGauges = defineCapability<Record<string, never>>({
  key: "get_kill_gauges",
  label: "Get kill-switch gauges",
  kind: "read",
  description:
    "Read per-session kill-switch gauges: daily PnL vs loss limit, drawdown, live readiness.",
  inputSchema: emptyInputSchema,
  describe: () => "Read kill-switch gauges for all sessions.",
  execute: (_input, services) => ({
    halted: services.killSwitch.isHalted(),
    gauges: services.killSwitch.gauges().map((g) => ({
      sessionId: g.sessionId,
      sessionName: g.sessionName,
      status: g.status,
      dailyPnlUsd: g.dailyPnlUsd,
      dailyLossLimitUsd: g.dailyLossLimitUsd,
      drawdownFraction: g.drawdownFraction,
      maxDrawdownFraction: g.maxDrawdownFraction,
      liveReady: g.liveReadiness?.readyToStart ?? null,
    })),
  }),
});

export const pauseAllSessions = defineCapability<Record<string, never>>({
  key: "pause_all_sessions",
  label: "Pause all sessions",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.sessionLifecycle,
  description:
    "Emergency pause of every active/attention/monitoring session. Engages the order halt.",
  inputSchema: emptyInputSchema,
  describe: () => "Pause all active sessions (kill-switch pause-all).",
  execute: (_input, services) => services.killSwitch.pauseAll(),
});

export const killSession = defineCapability<{ session: string }>({
  key: "kill_session",
  label: "Kill session",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.sessionLifecycle,
  description:
    "Pause a session and raise a daily-loss supervisor alert (kill-switch).",
  inputSchema: sessionRefSchema,
  describe: (input) => `Kill-switch pause session "${input.session}".`,
  risk: (input, services) => {
    try {
      const session = resolveSession(services, input.session);
      if (session.executionMode === "live_allowed") {
        return {
          level: "live",
          note: "This kills a session configured for a LIVE broker account.",
        };
      }
      return null;
    } catch {
      return null;
    }
  },
  affectedEntity: (input) => `session:${input.session}`,
  execute: async (input, services) => {
    const session = resolveSession(services, input.session);
    const status = await services.killSwitch.killSession(session.id);
    return { sessionId: session.id, ...status };
  },
});

export const flattenAll = defineCapability<Record<string, never>>({
  key: "flatten_all",
  label: "Flatten everything",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.tradeExecution,
  alwaysConfirm: true,
  description:
    "Emergency flatten: pause all sessions, cancel pending orders, and liquidate open positions. Requires explicit operator confirmation.",
  inputSchema: emptyInputSchema,
  describe: (_input, services) => {
    const open = services.repos.trades
      .listAllFiltered({})
      .filter((t) => OPEN_TRADE_STATUSES.has(t.status));
    return `Flatten everything: cancel/close ${open.length} open/pending trade(s).`;
  },
  risk: (_input, services) => {
    const open = services.repos.trades
      .listAllFiltered({})
      .filter((t) => OPEN_TRADE_STATUSES.has(t.status));
    const brokers = services.repos.brokerAccounts.list();
    const hasLive = open.some((t) => {
      if (!t.brokerAccountId) return false;
      return brokers.find((b) => b.id === t.brokerAccountId)?.mode === "live";
    });
    return hasLive
      ? {
          level: "live",
          note: "Open LIVE-broker positions will be canceled/liquidated.",
        }
      : {
          level: "normal",
          note: "Cancels pending and liquidates open paper positions across all sessions.",
        };
  },
  execute: (_input, services) => services.killSwitch.flattenAll("FLATTEN"),
});
