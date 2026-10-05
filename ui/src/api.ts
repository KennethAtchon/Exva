// Typed client for the engine API, plus the WebSocket that keeps every screen live.
import type {
  Account,
  Backtest,
  BacktestMetrics,
  Bot,
  BotRisk,
  BotSummary,
  Decision,
  EngineEvent,
  EquityPoint,
  Journal,
  Order,
  Proposal,
  Settings,
  Status,
  StrategyInfo,
  Timeframe,
  Trade,
  WsMessage,
} from "@shared/types.ts";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

function readToken(): string {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="exva-token"]')?.content;
  const fromUrl = new URLSearchParams(location.search).get("token");
  const token = meta || fromUrl || sessionStorage.getItem("exva.token") || "";
  if (token) sessionStorage.setItem("exva.token", token);
  return token;
}
const token = readToken();

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok)
    throw new Error((json as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
  return json as T;
}

export interface BotInput {
  name: string;
  strategyId: string;
  params: Record<string, unknown>;
  symbols: string[];
  timeframe: Timeframe;
  accountId: string;
  dollarsPerTrade: number;
  risk: BotRisk;
  backtestId?: string | null;
}

export interface BacktestRequest {
  strategyId: string;
  params: Record<string, unknown>;
  symbols: string[];
  timeframe: Timeframe;
  days: number;
  startingCash?: number;
  dollarsPerTrade?: number;
  slippageBps?: number;
  feeBps?: number;
  risk: BotRisk;
  aiMaxCalls?: number;
}

export interface Chart {
  symbol: string;
  timeframe: Timeframe;
  bars: { ts: number; o: number; h: number; l: number; c: number; v: number }[];
  markers: { ts: number; side: "buy" | "sell"; price: number; qty: number }[];
}

export type BacktestListItem = Omit<Backtest, "trades" | "equity" | "fills" | "decisionCounts">;

const qs = (p: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(p))
    if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  return s.toString();
};

export const api = {
  status: () => call<Status>("GET", "/api/status"),
  accounts: () => call<Account[]>("GET", "/api/accounts"),
  saveAccount: (a: {
    id?: string;
    name: string;
    broker: "alpaca" | "sim";
    keyId?: string;
    secretKey?: string;
    startingCash?: number;
  }) => call<Account>("POST", "/api/accounts", a),
  testAccount: (id: string) =>
    call<{ ok: boolean; message: string }>("POST", `/api/accounts/${id}/test`),
  strategies: () => call<StrategyInfo[]>("GET", "/api/strategies"),
  bots: () => call<Bot[]>("GET", "/api/bots"),
  bot: (id: string) => call<{ bot: Bot; warnings: string[] }>("GET", `/api/bots/${id}`),
  createBot: (b: BotInput) => call<{ bot: Bot; warnings: string[] }>("POST", "/api/bots", b),
  updateBot: (id: string, b: Partial<BotInput>) =>
    call<{ bot: Bot; warnings: string[] }>("PATCH", `/api/bots/${id}`, b),
  deleteBot: (id: string) => call<{ ok: boolean }>("DELETE", `/api/bots/${id}`),
  startBot: (id: string) => call<Bot>("POST", `/api/bots/${id}/start`),
  stopBot: (id: string, closePositions = false) =>
    call<Bot>("POST", `/api/bots/${id}/stop`, { closePositions }),
  decisions: (
    id: string,
    p: { kinds?: string; symbol?: string; limit?: number; before?: number } = {},
  ) => call<Decision[]>("GET", `/api/bots/${id}/decisions?${qs(p)}`),
  summary: (id: string) => call<BotSummary>("GET", `/api/bots/${id}/summary`),
  chart: (p: { symbol: string; timeframe: Timeframe; from?: number; to?: number; bot?: string }) =>
    call<Chart>("GET", `/api/chart?${qs(p)}`),
  orders: (p: { bot?: string; limit?: number } = {}) =>
    call<Order[]>("GET", `/api/orders?${qs(p)}`),
  trades: (p: { bot?: string; status?: "open" | "closed"; limit?: number; since?: number } = {}) =>
    call<Trade[]>("GET", `/api/trades?${qs(p)}`),
  equity: (p: { account?: string; from?: number; to?: number } = {}) =>
    call<EquityPoint[]>("GET", `/api/equity?${qs(p)}`),
  events: (p: { kind?: string; limit?: number } = {}) =>
    call<EngineEvent[]>("GET", `/api/events?${qs(p)}`),
  backtests: () => call<BacktestListItem[]>("GET", "/api/backtests"),
  backtest: (id: string) => call<Backtest>("GET", `/api/backtests/${id}`),
  startBacktest: (b: BacktestRequest) => call<{ id: string }>("POST", "/api/backtests", b),
  preview: (b: BacktestRequest) =>
    call<{
      metrics: BacktestMetrics;
      equity: EquityPoint[];
      decisionCounts: Backtest["decisionCounts"];
    }>("POST", "/api/preview", b),
  settings: () => call<Settings>("GET", "/api/settings"),
  saveSettings: (p: Record<string, unknown>) => call<Settings>("PUT", "/api/settings", p),
  killSwitch: (on: boolean) => call<Status>("POST", "/api/kill-switch", { on }),
  journal: () => call<Journal | null>("GET", "/api/journal"),
  writeJournal: () => call<Journal>("POST", "/api/journal"),
  explain: (ref: { decisionId?: string; tradeId?: string }) =>
    call<{ text: string }>("POST", "/api/explain", ref),
  assistant: (messages: { role: "user" | "assistant"; content: string }[]) =>
    call<{ reply: string; proposals: Proposal[] }>("POST", "/api/assistant", { messages }),
};

// Shared queries so every screen reads the same cache.
export const useStatus = () =>
  useQuery({ queryKey: ["status"], queryFn: api.status, refetchInterval: 30_000 });
export const useBots = () => useQuery({ queryKey: ["bots"], queryFn: api.bots });
export const useStrategies = () =>
  useQuery({
    queryKey: ["strategies"],
    queryFn: api.strategies,
    staleTime: Number.POSITIVE_INFINITY,
  });
export const useAccounts = () => useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
export const useSettings = () => useQuery({ queryKey: ["settings"], queryFn: api.settings });
export const useSummary = (id: string) =>
  useQuery({ queryKey: ["summary", id], queryFn: () => api.summary(id), refetchInterval: 60_000 });

/** Which cached queries each engine message makes stale. */
function staleKeys(msg: WsMessage): string[][] {
  switch (msg.type) {
    case "decision":
      return [
        ["summary", msg.data.botId],
        ["decisions", msg.data.botId],
      ];
    case "order":
      return [["orders"], ["trades"], ["summary", msg.data.botId]];
    case "trade":
      return [["trades"], ["summary", msg.data.botId], ["chart"]];
    case "bot":
      return [["bots"], ["bot", msg.data.id], ["summary", msg.data.id]];
    case "event":
      return msg.data.kind === "journal" ? [["events"], ["journal"]] : [["events"], ["status"]];
    case "backtest":
      return [["backtests"], ["backtest", msg.data.id]];
    case "status":
      return [["status"], ["equity"]];
  }
}

/** Keeps the cache fresh from the engine's event stream; reconnects with backoff. */
export function useEngineEvents(client: QueryClient, onMessage?: (m: WsMessage) => void): void {
  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 1_000;
    const pending = new Map<string, string[]>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      for (const key of pending.values()) client.invalidateQueries({ queryKey: key });
      pending.clear();
      timer = null;
    };
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/api/ws?token=${encodeURIComponent(token)}`);
      ws.onopen = () => {
        retry = 1_000;
        client.invalidateQueries();
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string) as WsMessage;
        onMessage?.(msg);
        for (const key of staleKeys(msg)) pending.set(key.join("|"), key);
        timer ??= setTimeout(flush, 250); // batch bursts of decisions
      };
      ws.onclose = () => {
        if (closed) return;
        setTimeout(connect, retry);
        retry = Math.min(retry * 2, 15_000);
      };
    };
    connect();
    return () => {
      closed = true;
      ws?.close();
      if (timer) clearTimeout(timer);
    };
  }, [client, onMessage]);
}
