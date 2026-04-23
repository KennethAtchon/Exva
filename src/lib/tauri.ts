// Typed wrappers around Tauri invoke() + event listeners.
// When running outside Tauri (plain vite dev), falls back to mock data so
// the UI can still render.

import type {
  Trade,
  TradeDetail,
  SessionConfig,
  DashboardStats,
  CostBreakdown,
  EventRow,
  AgentRun,
  ConnectionTestResult,
  BrokerCredentials,
  SessionStatus,
  TradeDecisionPayload,
} from "./types";
import { MOCK } from "./mock";

const isTauri =
  typeof window !== "undefined" &&
  !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

async function call<T>(cmd: string, args?: Record<string, unknown>, fallback?: T): Promise<T> {
  if (!isTauri) {
    if (fallback === undefined) throw new Error(`Tauri not available: ${cmd}`);
    return fallback;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export const api = {
  // Stats
  getDashboardStats: () =>
    call<DashboardStats>("get_dashboard_stats", undefined, MOCK.stats),
  getCostBreakdown: (dateRange?: string) =>
    call<CostBreakdown>(
      "get_cost_breakdown",
      { dateRange: dateRange ?? "today" },
      MOCK.costs,
    ),

  // Trades
  getActiveTrades: () => call<Trade[]>("get_active_trades", undefined, MOCK.trades),
  getTradeDetail: (tradeId: string) =>
    call<TradeDetail>("get_trade_detail", { tradeId }, {
      trade: MOCK.trades.find((t) => t.id === tradeId)!,
      runs: MOCK.runs.filter((r) => r.trade_id === tradeId),
    }),
  forceCloseTrade: (tradeId: string) =>
    call<void>("force_close_trade", { tradeId }, undefined as unknown as void),
  approveTrade: (tradeId: string, approved: boolean) =>
    call<void>("approve_trade", { tradeId, approved }, undefined as unknown as void),

  // Session
  startSession: () =>
    call<SessionStatus>("start_session", undefined, "active" as SessionStatus),
  pauseSession: () =>
    call<SessionStatus>("pause_session", undefined, "paused" as SessionStatus),
  stopSession: () =>
    call<SessionStatus>("stop_session", undefined, "stopped" as SessionStatus),

  // Config
  getStrategyConfig: () =>
    call<SessionConfig>("get_strategy_config", undefined, MOCK.config),
  saveStrategyConfig: (cfg: SessionConfig) =>
    call<void>("save_strategy_config", { cfg }, undefined as unknown as void),

  // Broker / credentials
  addBrokerAccount: (creds: BrokerCredentials) =>
    call<ConnectionTestResult>("add_broker_account", { creds }, {
      ok: true,
      message: "Mock: connected",
      account_balance: 100000,
    }),
  testBrokerConnection: () =>
    call<ConnectionTestResult>("test_broker_connection", undefined, {
      ok: true,
      message: "Mock: connected",
    }),
  removeBrokerAccount: () =>
    call<void>("remove_broker_account", undefined, undefined as unknown as void),
  saveApiKey: (keyType: string, value: string) =>
    call<void>("save_api_key", { keyType, value }, undefined as unknown as void),

  // Events / dev
  getEvents: (filters?: {
    minLevel?: string;
    agentType?: string;
    search?: string;
    limit?: number;
  }) => call<EventRow[]>("get_events", { filters }, MOCK.events),
  getAgentTraces: (tradeId: string) =>
    call<AgentRun[]>(
      "get_agent_traces",
      { tradeId },
      MOCK.runs.filter((r) => r.trade_id === tradeId),
    ),
};

// Event listeners
export type TauriEventName =
  | "trade_opened"
  | "trade_closed"
  | "agent_event"
  | "approval_required"
  | "session_stopped"
  | "stats_update"
  | "notification";

export interface TauriEventMap {
  trade_opened: Trade;
  trade_closed: Trade;
  agent_event: EventRow;
  approval_required: TradeDecisionPayload;
  session_stopped: { reason: string };
  stats_update: DashboardStats;
  notification: { title: string; body: string; level: string };
}

export async function listenEvent<K extends TauriEventName>(
  name: K,
  handler: (payload: TauriEventMap[K]) => void,
): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  const unlisten = await listen<TauriEventMap[K]>(name, (ev) => handler(ev.payload));
  return unlisten;
}

export { isTauri };
