import { describe, expect, test } from "bun:test";
import { REASONS } from "@shared/reasons.ts";
import { Orders } from "../src/broker/orders.ts";
import { SimBroker } from "../src/broker/sim.ts";
import { etToEpoch, nextCheckTime, UsEquityCalendar } from "../src/core/calendar.ts";
import { nullSink } from "../src/core/events.ts";
import { Runner } from "../src/core/runner.ts";
import { STRATEGIES, strategyInfo } from "../src/strategies/index.ts";
import { ema, priorHigh, rsi, sma } from "../src/strategies/indicators.ts";
import { fmtNum, usd } from "../src/util.ts";
import { bot, DAY, synthEnv, T0 } from "./helpers.ts";

describe("indicators", () => {
  test("sma and ema", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([Number.NaN, Number.NaN, 2, 3, 4]);
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([Number.NaN, Number.NaN, 2, 3, 4]);
  });
  test("rsi extremes", () => {
    const up = Array.from({ length: 20 }, (_, i) => i);
    expect(rsi(up, 2).at(-1)).toBe(100);
    expect(
      rsi(
        up.map((x) => -x),
        2,
      ).at(-1),
    ).toBe(0);
    expect(
      rsi(
        up.map(() => 5),
        2,
      ).at(-1),
    ).toBe(50);
  });
  test("prior high excludes the bar being judged", () => {
    const bars = [1, 2, 3, 10].map((h, i) => ({ ts: i, o: 0, h, l: 0, c: 0, v: 0 }));
    expect(priorHigh(bars, 3)).toBe(3);
  });
});

describe("calendar", () => {
  const cal = new UsEquityCalendar();
  test("holidays, observed days and early closes", () => {
    expect(cal.session("2026-01-19")).toBeNull(); // MLK
    expect(cal.session("2026-04-03")).toBeNull(); // Good Friday
    expect(cal.session("2026-07-03")).toBeNull(); // July 4 is a Saturday
    expect(cal.session("2027-12-24")).toBeNull(); // Christmas Saturday, observed Friday
    expect(cal.session("2021-12-31")).not.toBeNull(); // Saturday New Year's is not observed
    expect(cal.session("2026-11-27")?.close).toBe(etToEpoch(2026, 11, 27, 13, 0));
    expect(cal.session("2025-07-03")?.close).toBe(etToEpoch(2025, 7, 3, 13, 0));
  });
  test("daylight saving time", () => {
    expect(cal.session("2026-01-15")?.open).toBe(Date.UTC(2026, 0, 15, 14, 30));
    expect(cal.session("2026-03-10")?.open).toBe(Date.UTC(2026, 2, 10, 13, 30));
  });
  test("a bar is acted on only while orders can still be placed", () => {
    const at = (h: number, m: number) => etToEpoch(2026, 1, 15, h, m);
    expect(cal.isTickTime(at(9, 30))).toBe(false);
    expect(cal.isTickTime(at(9, 45))).toBe(true);
    expect(cal.isTickTime(at(15, 45))).toBe(true);
    expect(cal.isTickTime(at(16, 0))).toBe(false);
  });
  test("next check for a stock bot skips nights, weekends and holidays", () => {
    const fridayClose = etToEpoch(2026, 1, 16, 16, 0);
    expect(nextCheckTime(cal, ["SPY"], "15m", fridayClose)).toBe(etToEpoch(2026, 1, 20, 9, 45)); // Mon is MLK
    expect(nextCheckTime(cal, ["BTC/USD"], "15m", fridayClose)).toBe(fridayClose + 900_000);
  });
  test("a stock bot checked just before the open runs at the day's first bar", () => {
    const at = (h: number, m: number) => etToEpoch(2026, 10, 5, h, m);
    expect(nextCheckTime(cal, ["SPY"], "5m", at(9, 27))).toBe(at(9, 35));
    expect(nextCheckTime(cal, ["SPY"], "15m", at(9, 20))).toBe(at(9, 45));
  });
});

describe("runner", () => {
  async function setup(over: Parameters<typeof bot>[0] = {}) {
    const env = synthEnv(T0 + 10 * DAY);
    const b = bot(over);
    env.store.upsertAccount({
      id: b.accountId,
      name: "Sim",
      broker: "sim",
      mode: "sim",
      startingCash: 100_000,
      createdAt: T0,
    });
    env.store.saveBot(b);
    const sim = new SimBroker({
      accountId: b.accountId,
      store: env.store,
      prices: { firstOpenAtOrAfter: async () => null, lastClose: () => 100 },
      clock: env.clock,
      startingCash: 100_000,
      slippageBps: 0,
      feeBps: 0,
    });
    const orders = new Orders({
      store: env.store,
      brokerFor: () => sim,
      clock: env.clock,
      events: nullSink,
    });
    let kill = false;
    const runner = new Runner({
      store: env.store,
      feed: env.bars,
      orders,
      brokerFor: () => sim,
      accountMode: () => "sim",
      marketOpen: () => true,
      ai: null,
      clock: env.clock,
      events: nullSink,
      killSwitch: () => kill,
    });
    const t = T0 + 5 * DAY;
    await env.bars.sync(b.symbols, b.timeframe, t);
    return { ...env, b, runner, t, setKill: (v: boolean) => (kill = v) };
  }

  test("exactly one decision per bot, symbol and bar", async () => {
    const { runner, b, t, store } = await setup();
    const first = await runner.tick(b, "BTC/USD", t);
    expect(first?.kind).toBe("buy");
    expect(await runner.tick(b, "BTC/USD", t)).toBeNull();
    expect(store.listDecisions(b.id).length).toBe(1);
    expect(store.activeOrders().length).toBe(1);
  });

  test("a working order blocks a second order", async () => {
    const { runner, b, t, bars } = await setup();
    await runner.tick(b, "BTC/USD", t);
    await bars.sync(b.symbols, b.timeframe, t + 300_000);
    const next = await runner.tick(b, "BTC/USD", t + 300_000);
    expect(next?.code).toBe("order_pending");
  });

  test("kill switch stops everything", async () => {
    const { runner, b, t, setKill } = await setup();
    setKill(true);
    expect((await runner.tick(b, "BTC/USD", t))?.code).toBe("kill_switch");
  });

  test("missing bars are a visible stale_data skip, not silence", async () => {
    const { runner, b, t } = await setup();
    const d = await runner.tick(b, "BTC/USD", t + 3 * 3_600_000);
    expect(d?.kind).toBe("skip");
    expect(d?.code).toBe("stale_data");
    expect(d?.message).toContain("No ");
  });

  test("too little history is reported with the numbers", async () => {
    // 1h bars: the 30-day backfill holds 720 bars, the strategy wants 1,200.
    const { runner, store, t } = await setup({
      strategyId: "ema-cross",
      timeframe: "1h",
      params: { fast: 9, slow: 400 },
    });
    const d = await runner.tick(store.getBot("bot_1")!, "BTC/USD", t);
    expect(d?.code).toBe("insufficient_history");
    expect(d?.values.need).toBe(1200);
  });

  test("another bot holding the symbol blocks a buy", async () => {
    const { runner, b, t, store } = await setup();
    store.saveTrade({
      id: "trd_other",
      botId: "bot_other",
      accountId: b.accountId,
      symbol: "BTC/USD",
      status: "open",
      qty: 1,
      entryPrice: 100,
      exitQty: 0,
      exitPrice: null,
      fees: 0,
      stopPct: null,
      targetPct: null,
      openedAt: T0,
      closedAt: null,
      pnlUsd: null,
      pnlPct: null,
      exitReason: null,
      entryOrderId: null,
      exitOrderId: null,
    });
    expect((await runner.tick(b, "BTC/USD", t))?.code).toBe("symbol_owned_by_other_bot");
  });

  test("bad settings become a strategy_error decision instead of a crash", async () => {
    const { runner, t, store } = await setup({
      strategyId: "ema-cross",
      params: { fast: 50, slow: 10 },
    });
    const d = await runner.tick(store.getBot("bot_1")!, "BTC/USD", t);
    expect(d?.kind).toBe("error");
    expect(d?.code).toBe("strategy_error");
  });
});

describe("contracts", () => {
  test("every reason code has human text", () => {
    for (const [code, def] of Object.entries(REASONS))
      expect(def.text.length, code).toBeGreaterThan(3);
  });
  test("every strategy exposes a JSON schema and valid defaults", () => {
    for (const s of STRATEGIES) {
      const info = strategyInfo(s);
      expect(info.params.type).toBe("object");
      expect(s.warmup(s.params.parse({}))).toBeGreaterThan(0);
    }
  });
  test("number formatting", () => {
    expect(fmtNum(64123.456)).toBe("64,123.46");
    expect(fmtNum(0.012345)).toBe("0.0123");
    expect(usd(-1234.5)).toBe("-$1,234.50");
  });
});
