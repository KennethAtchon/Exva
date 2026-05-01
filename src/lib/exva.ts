import type {
  AgentRole,
  AgentRun,
  BrokerCredentials,
  ConnectionTestResult,
  CostBreakdown,
  DashboardStats,
  EventRow,
  SessionConfig,
  SessionStatus,
  Trade,
  TradeDecisionPayload,
  TradeDetail,
} from "./types";
import { MOCK } from "./mock";

const SHOW_MOCK = false;

const hasExva =
  typeof window !== "undefined" &&
  typeof window.exva === "object" &&
  window.exva !== null;

const showMock = SHOW_MOCK;

function bridgeUnavailableError(): Error {
  return new Error(
    "EXVA bridge unavailable and mock data is disabled. Start the app with `npm run dev`/`npm start` instead of `npm run dev:renderer`, or set SHOW_MOCK to true.",
  );
}

async function call<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
  if (showMock) return fallback;
  if (!hasExva) throw bridgeUnavailableError();
  return operation();
}

export const api = {
  getDashboardStats: () =>
    call<DashboardStats>(() => window.exva!.dashboard.getStats(), MOCK.stats),
  getCostBreakdown: (dateRange?: string) =>
    call<CostBreakdown>(
      () => window.exva!.dashboard.getCostBreakdown(dateRange ?? "today"),
      MOCK.costs,
    ),

  getActiveTrades: () =>
    call<Trade[]>(() => window.exva!.trades.listActive(), MOCK.trades),
  getTradeDetail: (tradeId: string) =>
    call<TradeDetail>(
      () => window.exva!.trades.getDetail(tradeId),
      {
        trade: MOCK.trades.find((trade) => trade.id === tradeId) ?? MOCK.trades[0],
        runs: MOCK.runs.filter((run) => run.trade_id === tradeId),
      },
    ),
  forceCloseTrade: (tradeId: string) =>
    call<void>(() => window.exva!.trades.forceClose(tradeId), undefined as void),
  approveTrade: (tradeId: string, approved: boolean) =>
    call<void>(() => window.exva!.trades.approve(tradeId, approved), undefined as void),

  startSession: () =>
    call<SessionStatus>(() => window.exva!.session.start(), "active"),
  pauseSession: () =>
    call<SessionStatus>(() => window.exva!.session.pause(), "paused"),
  stopSession: () =>
    call<SessionStatus>(() => window.exva!.session.stop(), "stopped"),

  getStrategyConfig: () =>
    call<SessionConfig>(() => window.exva!.config.getStrategy(), MOCK.config),
  saveStrategyConfig: (cfg: SessionConfig) =>
    call<void>(() => window.exva!.config.saveStrategy(cfg), undefined as void),

  addBrokerAccount: (creds: BrokerCredentials) =>
    call<ConnectionTestResult>(() => window.exva!.accounts.saveBroker(creds), {
      ok: true,
      message: "Mock broker connected",
      account_balance: 100000,
    }),
  testBrokerConnection: () =>
    call<ConnectionTestResult>(() => window.exva!.accounts.testBroker(), {
      ok: true,
      message: "Mock broker connected",
    }),
  removeBrokerAccount: () =>
    call<void>(() => window.exva!.accounts.removeBroker(), undefined as void),
  saveApiKey: (keyType: string, value: string) =>
    call<void>(() => window.exva!.accounts.saveApiKey(keyType, value), undefined as void),

  getEvents: (filters?: {
    minLevel?: string;
    agentType?: AgentRole;
    search?: string;
    limit?: number;
  }) => call<EventRow[]>(() => window.exva!.events.list(filters), MOCK.events),
  getAgentTraces: (tradeId: string) =>
    call<AgentRun[]>(
      () => window.exva!.events.getAgentTraces(tradeId),
      MOCK.runs.filter((run) => run.trade_id === tradeId),
    ),
};

export type ExvaEventName =
  | "trade_opened"
  | "trade_closed"
  | "agent_event"
  | "approval_required"
  | "session_started"
  | "session_stopped"
  | "stats_update"
  | "notification";

export interface ExvaEventMap {
  trade_opened: Trade;
  trade_closed: Trade;
  agent_event: EventRow;
  approval_required: TradeDecisionPayload;
  session_started: {};
  session_stopped: { reason: string };
  stats_update: DashboardStats;
  notification: { title: string; body: string; level: string };
}

export async function listenEvent<K extends ExvaEventName>(
  name: K,
  handler: (payload: ExvaEventMap[K]) => void,
): Promise<() => void> {
  if (showMock) return () => {};
  if (!hasExva) throw bridgeUnavailableError();
  return window.exva!.events.subscribe(name, handler);
}

export { hasExva, showMock };
