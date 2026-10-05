import type { BacktestSpec, Bot, BotRisk } from "@shared/types.ts";
import { UsEquityCalendar } from "../src/core/calendar.ts";
import { SimClock } from "../src/core/clock.ts";
import type { BarProvider } from "../src/data/alpaca-data.ts";
import { BarStore } from "../src/data/bar-store.ts";
import { SyntheticData } from "../src/data/synthetic.ts";
import { Store } from "../src/store/store.ts";

export const DAY = 86_400_000;
/** A fixed Thursday so results never depend on when the tests run. */
export const T0 = Date.UTC(2026, 0, 15, 0, 0);

export function synthEnv(now = T0 + 400 * DAY, provider?: BarProvider) {
  const store = Store.open(":memory:");
  const calendar = new UsEquityCalendar();
  const clock = new SimClock(now);
  const data = provider ?? new SyntheticData(calendar);
  const bars = new BarStore(
    store,
    () => data,
    clock,
    () => "synthetic",
  );
  return { store, calendar, clock, bars, data };
}

export const noRisk: BotRisk = {
  stopLossPct: null,
  takeProfitPct: null,
  maxHoldBars: null,
  maxPositions: 10,
  dailyLossLimitUsd: 0,
};

export function spec(over: Partial<BacktestSpec> = {}): BacktestSpec {
  return {
    strategyId: "heartbeat",
    params: {},
    symbols: ["BTC/USD"],
    timeframe: "5m",
    from: T0,
    to: T0 + DAY,
    startingCash: 100_000,
    dollarsPerTrade: 1_000,
    slippageBps: 0,
    feeBps: 0,
    risk: noRisk,
    aiMaxCalls: 0,
    ...over,
  };
}

export function bot(over: Partial<Bot> = {}): Bot {
  return {
    id: "bot_1",
    name: "Test bot",
    strategyId: "heartbeat",
    params: {},
    symbols: ["BTC/USD"],
    timeframe: "5m",
    accountId: "acct_sim",
    dollarsPerTrade: 1_000,
    risk: noRisk,
    status: "running",
    backtestId: null,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}
