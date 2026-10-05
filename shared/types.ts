// Domain types shared by the engine and the UI. Vocabulary is closed: see docs/GLOSSARY.md.
import type { ReasonCode } from "./reasons.ts";

export type Timeframe = "5m" | "15m" | "1h";
export const TIMEFRAMES: Timeframe[] = ["5m", "15m", "1h"];
export const TIMEFRAME_MS: Record<Timeframe, number> = {
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
};

export type AssetClass = "crypto" | "stock";
/** Crypto pairs are written with a slash (BTC/USD); everything else is a US stock or ETF. */
export const assetClassOf = (symbol: string): AssetClass =>
  symbol.includes("/") ? "crypto" : "stock";

export interface Bar {
  ts: number; // bar START time, epoch ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type BrokerKind = "alpaca" | "sim";
export interface Account {
  id: string;
  name: string;
  broker: BrokerKind;
  mode: "paper" | "sim";
  startingCash: number | null;
  hasKeys: boolean;
  createdAt: number;
}

export interface BotRisk {
  stopLossPct: number | null;
  takeProfitPct: number | null;
  maxHoldBars: number | null;
  maxPositions: number;
  dailyLossLimitUsd: number;
}

export type BotStatus = "running" | "stopped";
export interface Bot {
  id: string;
  name: string;
  strategyId: string;
  params: Record<string, unknown>;
  symbols: string[];
  timeframe: Timeframe;
  accountId: string;
  dollarsPerTrade: number;
  risk: BotRisk;
  status: BotStatus;
  backtestId: string | null;
  createdAt: number;
  updatedAt: number;
}

export type DecisionKind = "buy" | "sell" | "hold" | "skip" | "error";
export interface Decision {
  id: string;
  botId: string;
  symbol: string;
  barTs: number; // close time of the bar that was checked
  kind: DecisionKind;
  code: ReasonCode;
  message: string;
  values: Record<string, number>;
  orderId: string | null;
  aiCallId: string | null;
  createdAt: number;
}

export type Side = "buy" | "sell";
export type OrderStatus =
  | "pending_submit"
  | "submitted"
  | "partially_filled"
  | "filled"
  | "canceled"
  | "rejected"
  | "expired"
  | "submit_unknown";
export const TERMINAL_ORDER_STATUSES: OrderStatus[] = ["filled", "canceled", "rejected", "expired"];

export interface Order {
  id: string;
  clientOrderId: string;
  brokerOrderId: string | null;
  botId: string;
  accountId: string;
  symbol: string;
  side: Side;
  notional: number | null;
  qty: number | null;
  status: OrderStatus;
  filledQty: number;
  avgFillPrice: number | null;
  decisionId: string | null;
  reason: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Fill {
  id: string;
  orderId: string;
  qty: number;
  price: number;
  fee: number;
  ts: number;
}

/** A Trade is one round trip. While status is "open" it is also the bot's Position in that symbol. */
export interface Trade {
  id: string;
  botId: string;
  accountId: string;
  symbol: string;
  status: "open" | "closed";
  qty: number;
  entryPrice: number;
  exitQty: number;
  exitPrice: number | null;
  fees: number;
  stopPct: number | null;
  targetPct: number | null;
  openedAt: number;
  closedAt: number | null;
  pnlUsd: number | null;
  pnlPct: number | null;
  exitReason: string | null;
  entryOrderId: string | null;
  exitOrderId: string | null;
  lastPrice?: number | null;
  unrealizedPnl?: number | null;
}

export interface EquityPoint {
  ts: number;
  equity: number;
  cash: number;
}

export interface EngineEvent {
  id: number;
  ts: number;
  level: "info" | "warn" | "error";
  kind: string;
  message: string;
  data: Record<string, unknown> | null;
}

export interface StrategyInfo {
  id: string;
  name: string;
  description: string;
  usesAi: boolean;
  isTest: boolean;
  timeframes: Timeframe[];
  defaultTimeframe: Timeframe;
  defaultSymbols: string[];
  params: Record<string, unknown>; // JSON schema of the params object
  defaults: Record<string, unknown>;
}

export interface BotSummary {
  botId: string;
  since: number;
  checks: number;
  counts: Record<DecisionKind, number>;
  byCode: { code: ReasonCode; kind: DecisionKind; count: number }[];
  closest: { symbol: string; barTs: number; message: string } | null;
  tradesToday: number;
  pnlToday: number;
  openPositions: number;
  lastDecision: Decision | null;
  nextCheckAt: number | null;
  sleepingUntil: number | null;
}

export interface AccountHealth {
  id: string;
  name: string;
  broker: BrokerKind;
  ok: boolean;
  message: string;
  equity: number | null;
  cash: number | null;
}

export interface Status {
  version: string;
  mode: "live" | "demo";
  startedAt: number;
  now: number;
  killSwitch: boolean;
  botsRunning: number;
  accounts: AccountHealth[];
  data: { ok: boolean; message: string };
  ai: { configured: boolean; model: string; spentTodayUsd: number; budgetUsd: number; ok: boolean };
  market: { stocksOpen: boolean; nextOpen: number | null; nextClose: number | null };
  sleepGaps: { from: number; to: number }[];
  health: "ok" | "warn" | "error";
}

export interface BacktestSpec {
  strategyId: string;
  params: Record<string, unknown>;
  symbols: string[];
  timeframe: Timeframe;
  from: number;
  to: number;
  startingCash: number;
  dollarsPerTrade: number;
  slippageBps: number;
  feeBps: number;
  risk: BotRisk;
  aiMaxCalls: number;
}

export interface BacktestMetrics {
  days: number;
  startingCash: number;
  endingEquity: number;
  netPnl: number;
  netPnlPct: number;
  trades: number;
  tradesPerDay: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  profitFactor: number | null;
  maxDrawdown: number;
  maxDrawdownPct: number;
  sharpe: number | null;
  exposurePct: number;
  buyHoldPct: number | null;
  openAtEnd: number;
  aiCalls: number;
  aiCostUsd: number;
}

export interface BacktestFill {
  symbol: string;
  side: Side;
  ts: number;
  price: number;
  qty: number;
}

export interface Backtest {
  id: string;
  createdAt: number;
  status: "running" | "done" | "error";
  spec: BacktestSpec;
  metrics: BacktestMetrics | null;
  trades: Trade[];
  equity: EquityPoint[];
  fills: BacktestFill[];
  decisionCounts: { code: ReasonCode; kind: DecisionKind; count: number }[];
  error: string | null;
}

export type AiProvider = "openrouter" | "custom";
export interface Settings {
  onboarded: boolean;
  killSwitch: boolean;
  ai: {
    provider: AiProvider;
    baseUrl: string;
    model: string;
    inputPricePerM: number;
    cachedInputPricePerM: number;
    outputPricePerM: number;
    dailyBudgetUsd: number;
    journalHour: number; // local hour 0-23, -1 = off
    hasKey: boolean;
  };
  data: { stockFeed: "iex" | "sip" };
  defaults: { dollarsPerTrade: number; dailyLossLimitUsd: number };
  app: {
    launchAtLogin: boolean;
    keepRunningInTray: boolean;
    preventSleep: boolean;
    notifications: boolean;
  };
}

export interface Journal {
  ts: number;
  date: string;
  text: string;
}

export interface Proposal {
  label: string;
  action: "create_bot" | "update_bot" | "start_bot" | "stop_bot" | "run_backtest";
  payload: Record<string, unknown>;
}

export type WsMessage =
  | { type: "decision"; data: Decision }
  | { type: "order"; data: Order }
  | { type: "trade"; data: Trade }
  | { type: "bot"; data: Bot }
  | { type: "event"; data: EngineEvent }
  | { type: "backtest"; data: { id: string; status: Backtest["status"]; progress: number } }
  | { type: "status" };
