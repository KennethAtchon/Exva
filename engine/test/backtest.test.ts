import { describe, expect, test } from "bun:test";
import type { Bar, Decision, Timeframe } from "@shared/types.ts";
import { runBacktest } from "../src/backtest/run.ts";
import { UsEquityCalendar } from "../src/core/calendar.ts";
import type { BarProvider } from "../src/data/alpaca-data.ts";
import { SyntheticData } from "../src/data/synthetic.ts";
import { DAY, spec, synthEnv, T0 } from "./helpers.ts";

describe("backtest", () => {
  test("heartbeat trades every other bar and books every fill", async () => {
    const env = synthEnv();
    const bt = await runBacktest(spec(), env);
    const m = bt.metrics!;
    // 288 five-minute closes in a day: buy, sell, buy, sell... each round trip spans two bars.
    expect(m.trades).toBe(143);
    expect(m.openAtEnd).toBe(1);
    expect(bt.fills.length).toBe(287);
    // Money adds up: ending equity = cash + marked open position, and cash = start + realized P&L.
    const realized = bt.trades
      .filter((t) => t.status === "closed")
      .reduce((s, t) => s + (t.pnlUsd ?? 0), 0);
    const last = bt.equity[bt.equity.length - 1]!;
    expect(last.cash).toBeCloseTo(100_000 + realized - 1_000, 2);
  });

  test("fills happen at the open of the bar after the decision", async () => {
    const env = synthEnv();
    const decisions: Decision[] = [];
    const bt = await runBacktest(spec({ to: T0 + 3_600_000 }), {
      ...env,
      onDecision: (d) => decisions.push(d),
    });
    const firstBuy = decisions.find((d) => d.kind === "buy")!;
    const firstFill = bt.fills[0]!;
    expect(firstFill.ts).toBe(firstBuy.barTs); // the bar that STARTS when the decision is made
    const bar = env.bars.range("BTC/USD", "5m", firstFill.ts, firstFill.ts + 1)[0]!;
    expect(firstFill.price).toBeCloseTo(bar.o, 8);
  });

  test("fees and slippage reduce P&L", async () => {
    const env = synthEnv();
    const free = await runBacktest(spec(), env);
    const costly = await runBacktest(spec({ slippageBps: 5, feeBps: 10 }), env);
    expect(costly.metrics!.netPnl).toBeLessThan(free.metrics!.netPnl);
  });

  test("no look-ahead: future bars cannot change past decisions", async () => {
    const short = synthEnv();
    const base: Decision[] = [];
    await runBacktest(spec({ strategyId: "ema-cross", timeframe: "15m", to: T0 + 5 * DAY }), {
      ...short,
      onDecision: (d) => base.push(d),
    });

    // Same history, but every bar after the cut-off is wildly different.
    const cut = T0 + 5 * DAY;
    const synthetic = new SyntheticData(new UsEquityCalendar());
    const altered: BarProvider = {
      name: "altered",
      async fetchBars(symbols: string[], tf: Timeframe, from: number, to: number) {
        const out = await synthetic.fetchBars(symbols, tf, from, to);
        for (const [s, bars] of out) {
          out.set(
            s,
            bars.map(
              (b): Bar =>
                b.ts + 900_000 > cut
                  ? { ...b, o: b.o * 3, h: b.h * 3, l: b.l * 0.2, c: b.c * 0.4 }
                  : b,
            ),
          );
        }
        return out;
      },
    };
    const long = synthEnv(undefined, altered);
    const extended: Decision[] = [];
    await runBacktest(spec({ strategyId: "ema-cross", timeframe: "15m", to: T0 + 8 * DAY }), {
      ...long,
      onDecision: (d) => extended.push(d),
    });
    const strip = (d: Decision) => [d.symbol, d.barTs, d.kind, d.code, d.message];
    const before = extended.filter((d) => d.barTs <= cut).map(strip);
    expect(before).toEqual(base.map(strip));
    expect(base.length).toBeGreaterThan(400);
  });

  test("stock bots only check during regular hours", async () => {
    const env = synthEnv();
    const decisions: Decision[] = [];
    await runBacktest(
      spec({ strategyId: "rsi-dip", symbols: ["SPY"], timeframe: "15m", to: T0 + 7 * DAY }),
      {
        ...env,
        onDecision: (d) => decisions.push(d),
      },
    );
    // Jan 15-21 2026: Thu, Fri, (weekend), Mon is MLK day, Tue, Wed. 4 sessions x 25 checks (9:45 ... 15:45).
    expect(decisions.length).toBe(4 * 25);
    expect(new Set(decisions.map((d) => d.code)).has("stale_data")).toBe(false);
  });

  test("ema-cross on 90 days of 15m crypto trades several times a day", async () => {
    const env = synthEnv();
    const bt = await runBacktest(
      spec({
        strategyId: "ema-cross",
        symbols: ["BTC/USD", "ETH/USD"],
        timeframe: "15m",
        to: T0 + 90 * DAY,
      }),
      env,
    );
    expect(bt.metrics!.tradesPerDay).toBeGreaterThan(1);
    expect(bt.equity.length).toBeLessThanOrEqual(1500);
    expect(bt.decisionCounts.reduce((s, c) => s + c.count, 0)).toBe(90 * 96 * 2);
  });
});
