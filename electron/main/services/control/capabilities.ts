import { z } from "zod";
import { sessionCreateInputSchema } from "@electron/shared/validation/schemas";
import type { AppServices } from "../app-services";
import { runWithProviderCallScopeAsync } from "../infra/provider-call-log";
import { defineCapability, type Capability } from "./capability";

const CONFIRM_CLASS = {
  sessionLifecycle: "session_lifecycle",
  strategyWrite: "strategy_write",
  signalWrite: "signal_write",
  tradeExecution: "trade_execution",
  autopsy: "autopsy",
} as const;

function resolveSession(services: AppServices, ref: string) {
  const sessions = services.repos.session.list({ includeArchived: true });
  const byId = sessions.find((s) => s.id === ref);
  if (byId) return byId;
  const lower = ref.trim().toLowerCase();
  const byName = sessions.find((s) => s.name.toLowerCase() === lower);
  if (byName) return byName;
  const partial = sessions.filter((s) => s.name.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0];
  throw new Error(
    partial.length > 1
      ? `Ambiguous session "${ref}" — matches ${partial.map((s) => s.name).join(", ")}.`
      : `No session matching "${ref}".`,
  );
}

const OPEN_TRADE_STATUSES = new Set(["open", "pending"]);

const sessionRefSchema = z.object({
  session: z
    .string()
    .min(1)
    .describe("Session id or name (partial name allowed)."),
});

// --- Read capabilities ---

const listSessions = defineCapability<Record<string, never>>({
  key: "list_sessions",
  label: "List sessions",
  kind: "read",
  description:
    "List all trading sessions with their status, experience, execution mode, and open trade count.",
  inputSchema: z.object({}).strict() as unknown as z.ZodType<
    Record<string, never>
  >,
  describe: () => "List all sessions and their current status.",
  execute: (_input, services) => {
    const result = services.sessionListing.list({ includeArchived: false });
    return {
      sessions: result.sessions.map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        executionMode: s.executionMode,
        openTradeCount: s.openTradeCount,
      })),
    };
  },
});

const getSessionStatus = defineCapability<{ session: string }>({
  key: "get_session_status",
  label: "Get session status",
  kind: "read",
  description:
    "Get detailed status for one session: lifecycle state, execution mode, assigned brokers, subscribed signal sources, and open trades.",
  inputSchema: sessionRefSchema,
  describe: (input) => `Read status of session "${input.session}".`,
  execute: (input, services) => {
    const session = resolveSession(services, input.session);
    const status = services.session.getStatus(session.id);
    const trades = services.repos.trades
      .listAllFiltered({ sessionId: session.id })
      .filter((t) => OPEN_TRADE_STATUSES.has(t.status));
    const subscribedSourceIds = services.signals.listSubscribedSourceIds(
      session.id,
    );
    return {
      id: session.id,
      name: session.name,
      status,
      executionMode: session.executionMode,
      experienceId: session.experienceId,
      instrumentScope: session.instrumentScope,
      openTrades: trades.map((t) => ({
        symbol: t.instrumentSymbol,
        side: t.side,
        notionalUsd: t.position_size_usd,
      })),
      subscribedSourceIds,
    };
  },
});

const listActiveTrades = defineCapability<Record<string, never>>({
  key: "list_active_trades",
  label: "List active trades",
  kind: "read",
  description:
    "List all open positions across sessions with symbol, side, notional, broker, and unrealized context.",
  inputSchema: z.object({}).strict() as unknown as z.ZodType<
    Record<string, never>
  >,
  describe: () => "List all open trades and total open notional.",
  execute: (_input, services) => {
    const trades = services.repos.trades
      .listAllFiltered({})
      .filter((t) => OPEN_TRADE_STATUSES.has(t.status));
    const totalNotionalUsd = trades.reduce(
      (acc, t) => acc + (t.position_size_usd ?? 0),
      0,
    );
    return {
      count: trades.length,
      totalNotionalUsd,
      trades: trades.map((t) => ({
        id: t.id,
        symbol: t.instrumentSymbol,
        side: t.side,
        notionalUsd: t.position_size_usd,
        brokerAccountId: t.brokerAccountId ?? null,
        status: t.status,
        sessionId: t.sessionId ?? null,
      })),
    };
  },
});

const getStrategy = defineCapability<{ session: string }>({
  key: "get_strategy",
  label: "Get strategy config",
  kind: "read",
  description:
    "Get a session's strategy configuration: research posture, trade rules, risk limits, and timeframe horizon.",
  inputSchema: sessionRefSchema,
  describe: (input) => `Read strategy config for session "${input.session}".`,
  execute: (input, services) => {
    const session = resolveSession(services, input.session);
    return services.strategyContext.getPageData(session.id);
  },
});

const listSignalSources = defineCapability<Record<string, never>>({
  key: "list_signal_sources",
  label: "List signal sources",
  kind: "read",
  description:
    "List all signal sources with type, enabled state, runtime status, and how many sessions subscribe to each.",
  inputSchema: z.object({}).strict() as unknown as z.ZodType<
    Record<string, never>
  >,
  describe: () => "List all signal sources and their enabled state.",
  execute: (_input, services) => ({ sources: services.signals.listSources() }),
});

const getSignalReadiness = defineCapability<{ session: string }>({
  key: "get_signal_readiness",
  label: "Get signal readiness",
  kind: "read",
  description:
    "Diagnose whether a session is armed to receive signals (armed / manual_only / waiting_for_source_enable / no_inputs).",
  inputSchema: sessionRefSchema,
  describe: (input) => `Check signal readiness for session "${input.session}".`,
  execute: (input, services) => {
    const session = resolveSession(services, input.session);
    const readiness = services.signals.deriveReadiness(
      session.id,
      session.instrumentScope,
    );
    return {
      sessionId: session.id,
      readiness,
      subscribedSourceIds: services.signals.listSubscribedSourceIds(session.id),
    };
  },
});

const listBrokers = defineCapability<Record<string, never>>({
  key: "list_brokers",
  label: "List brokers",
  kind: "read",
  description:
    "List configured broker accounts with type, paper/live mode, and supported instrument classes.",
  inputSchema: z.object({}).strict() as unknown as z.ZodType<
    Record<string, never>
  >,
  describe: () => "List configured broker accounts.",
  execute: (_input, services) =>
    services.repos.brokerAccounts.list().map((b) => ({
      id: b.id,
      name: b.name,
      brokerType: b.brokerType,
      mode: b.mode,
      supportedInstrumentClasses: b.supportedInstrumentClasses,
    })),
});

// --- Mutating capabilities ---

const createSession = defineCapability<
  z.infer<typeof sessionCreateInputSchema>
>({
  key: "create_session",
  label: "Create session",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.sessionLifecycle,
  description:
    "Create a new trading session. Gather brokers (list_brokers) and decide an experience first so the inputs are concrete. brokerAssignments must reference real broker account ids.",
  inputSchema: sessionCreateInputSchema as unknown as z.ZodType<
    z.infer<typeof sessionCreateInputSchema>
  >,
  describe: (input) =>
    `Create session "${input.name}" (${input.experienceId ?? "edgar-catalyst"}, ${input.executionMode}) with ${input.brokerAssignments.length} broker assignment(s).`,
  risk: (input) =>
    input.executionMode === "live_allowed"
      ? "This session is configured for a LIVE broker account."
      : null,
  execute: (input, services) => services.sessionWrites.create(input),
});

function lifecycleCapability(
  key: string,
  label: string,
  verb: string,
  action: (services: AppServices, sessionId: string) => Promise<unknown>,
): Capability<unknown> {
  return defineCapability<{ session: string }>({
    key,
    label,
    kind: "mutating",
    confirmClass: CONFIRM_CLASS.sessionLifecycle,
    description: `${verb} a session.`,
    inputSchema: sessionRefSchema,
    describe: (input) => `${verb} session "${input.session}".`,
    affectedEntity: () => null,
    execute: async (input, services) => {
      const session = resolveSession(services, input.session);
      const status = await action(services, session.id);
      return { sessionId: session.id, status };
    },
  });
}

const startSession = lifecycleCapability(
  "start_session",
  "Start session",
  "Start",
  (services, id) => services.session.start(id),
);
const pauseSession = lifecycleCapability(
  "pause_session",
  "Pause session",
  "Pause",
  (services, id) => services.session.pause(id),
);
const resumeSession = lifecycleCapability(
  "resume_session",
  "Resume session",
  "Resume",
  (services, id) => services.session.resume(id),
);
const stopSession = lifecycleCapability(
  "stop_session",
  "Stop session",
  "Stop",
  (services, id) => services.session.stop(id),
);

const saveRiskConfig = defineCapability<{
  session: string;
  riskConfig: Record<string, unknown>;
}>({
  key: "save_risk_config",
  label: "Update risk config",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.strategyWrite,
  description:
    "Update a session's risk configuration (partial patch). Read get_strategy first to see current values.",
  inputSchema: z.object({
    session: z.string().min(1),
    riskConfig: z.record(z.unknown()),
  }),
  describe: (input) =>
    `Update risk config for "${input.session}": ${Object.keys(input.riskConfig).join(", ") || "(no fields)"}.`,
  execute: (input, services) => {
    const session = resolveSession(services, input.session);
    return services.strategyContext.saveRiskConfig(
      session.id,
      input.riskConfig as never,
    );
  },
});

const enableSignalSource = defineCapability<{ id: string }>({
  key: "enable_signal_source",
  label: "Enable signal source",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.signalWrite,
  description: "Enable a signal source by id (use list_signal_sources first).",
  inputSchema: z.object({ id: z.string().min(1) }),
  describe: (input) => `Enable signal source ${input.id}.`,
  affectedEntity: (input) => `signal_source:${input.id}`,
  execute: async (input, services) => {
    await services.signals.enableSource(input.id);
    return { ok: true };
  },
});

const disableSignalSource = defineCapability<{ id: string }>({
  key: "disable_signal_source",
  label: "Disable signal source",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.signalWrite,
  description: "Disable a signal source by id.",
  inputSchema: z.object({ id: z.string().min(1) }),
  describe: (input) => `Disable signal source ${input.id}.`,
  affectedEntity: (input) => `signal_source:${input.id}`,
  execute: async (input, services) => {
    await services.signals.disableSource(input.id);
    return { ok: true };
  },
});

const forceCloseTrade = defineCapability<{ tradeId: string }>({
  key: "force_close_trade",
  label: "Force close trade",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.tradeExecution,
  alwaysConfirm: true,
  description:
    "Force-close an open position immediately at market. This executes a real broker order on the trade's broker account.",
  inputSchema: z.object({ tradeId: z.string().min(1) }),
  describe: (input, services) => {
    try {
      const trade = services.repos.trades.require(input.tradeId);
      return `Force-close ${trade.side} ${trade.instrumentSymbol} (~$${Math.round(
        trade.position_size_usd,
      )} notional).`;
    } catch {
      return `Force-close trade ${input.tradeId}.`;
    }
  },
  risk: (input, services) => {
    try {
      const trade = services.repos.trades.require(input.tradeId);
      if (!trade.brokerAccountId) return null;
      const broker = services.repos.brokerAccounts
        .list()
        .find((b) => b.id === trade.brokerAccountId);
      return broker?.mode === "live"
        ? "This closes a position on a LIVE broker account."
        : null;
    } catch {
      return null;
    }
  },
  affectedEntity: (input) => `trade:${input.tradeId}`,
  execute: async (input, services) => {
    const trade = services.repos.trades.require(input.tradeId);
    let pnl = 0;
    if (trade.broker_order_id && trade.brokerAccountId) {
      const brokerAccountId = trade.brokerAccountId;
      const brokerOrderId = trade.broker_order_id;
      const result = await runWithProviderCallScopeAsync(
        {
          sessionId: trade.sessionId ?? null,
          tradeId: trade.id,
        },
        () => services.broker.closeOrder(brokerAccountId, brokerOrderId),
      );
      pnl = result.realizedPnlUsd;
    }
    const closed = services.repos.trades.updateStatus(
      input.tradeId,
      "closed",
      pnl,
    );
    services.capitalReservation.releaseOnClose(input.tradeId);
    services.eventBus.emit("trade_closed", closed);
    return { closed: true, realizedPnlUsd: pnl };
  },
});

const runPeriodAutopsy = defineCapability<{
  scope: "global" | "session";
  session?: string;
  windowStart: string;
  windowEnd: string;
  outcome?: "all" | "winners" | "losers";
}>({
  key: "run_period_autopsy",
  label: "Run period autopsy",
  kind: "mutating",
  confirmClass: CONFIRM_CLASS.autopsy,
  description:
    "Run a period autopsy over a date window. This calls the model and costs tokens. Dates are ISO (YYYY-MM-DD).",
  inputSchema: z.object({
    scope: z.enum(["global", "session"]),
    session: z.string().optional(),
    windowStart: z.string().min(1),
    windowEnd: z.string().min(1),
    outcome: z.enum(["all", "winners", "losers"]).optional(),
  }),
  describe: (input) =>
    `Run a ${input.scope} period autopsy over ${input.windowStart} → ${input.windowEnd} (calls the model, costs tokens).`,
  execute: (input, services) => {
    const sessionId =
      input.scope === "session" && input.session
        ? resolveSession(services, input.session).id
        : undefined;
    return services.periodAutopsy.run({
      scope: input.scope,
      sessionId,
      windowStart: input.windowStart,
      windowEnd: input.windowEnd,
      filters: {
        instrumentClasses: [],
        brokerAccountIds: [],
        outcome: input.outcome ?? "all",
        minPositionSizeUsd: 0,
        includeAgentPhases: [],
      },
      confirmHighCost: true,
    });
  },
});

export const CONTROL_CAPABILITIES: Capability<unknown>[] = [
  // read
  listSessions,
  getSessionStatus,
  listActiveTrades,
  getStrategy,
  listSignalSources,
  getSignalReadiness,
  listBrokers,
  // mutating
  createSession,
  startSession,
  pauseSession,
  resumeSession,
  stopSession,
  saveRiskConfig,
  enableSignalSource,
  disableSignalSource,
  forceCloseTrade,
  runPeriodAutopsy,
];
