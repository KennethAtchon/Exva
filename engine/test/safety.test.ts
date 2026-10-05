// Regression tests for the ways a bot's idea of its positions could drift from the broker's, and for
// scheduler isolation. Each test reproduces a failure found in review before it was fixed.
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Bar, Timeframe } from "@shared/types.ts";
import { assetClassOf } from "@shared/types.ts";
import { runBacktest } from "../src/backtest/run.ts";
import { UsEquityCalendar } from "../src/core/calendar.ts";
import { SimClock } from "../src/core/clock.ts";
import { splitRatio } from "../src/core/scheduler.ts";
import type { BarProvider } from "../src/data/alpaca-data.ts";
import { SyntheticData } from "../src/data/synthetic.ts";
import { Engine } from "../src/engine.ts";
import { DataError } from "../src/errors.ts";
import { fakeServer, TestClock } from "./fakes.ts";
import { DAY, noRisk, spec, synthEnv, T0 } from "./helpers.ts";

const tmpHome = () => mkdtempSync(join(tmpdir(), "exva-test-"));
const START = T0 + 3_600_000;

/** Alpaca paper, closely enough: market orders fill at once; crypto buys pay 0.25% in coin. */
function fakeAlpaca() {
  const orders = new Map<string, Record<string, string | null>>();
  const held = new Map<string, { qty: number; avg: number }>();
  const price = (s: string) => (assetClassOf(s) === "crypto" ? 100_000 : 500);
  const srv = fakeServer((r) => {
    const body = r.body as {
      symbol: string;
      side: string;
      qty?: string;
      notional?: string;
      client_order_id: string;
    };
    if (r.method === "POST" && r.path === "/v2/orders") {
      const key = body.symbol.replace("/", "");
      const pos = held.get(key) ?? { qty: 0, avg: price(body.symbol) };
      let qty = Number(body.qty);
      if (body.side === "buy") {
        qty = Number(body.notional) / price(body.symbol);
        pos.qty += assetClassOf(body.symbol) === "crypto" ? qty * 0.9975 : qty;
      } else if (qty > pos.qty + 1e-12) {
        return [
          403,
          { message: `insufficient balance (requested: ${qty}, available: ${pos.qty})` },
        ];
      } else pos.qty -= qty;
      held.set(key, pos);
      const o = {
        id: `b-${orders.size + 1}`,
        client_order_id: body.client_order_id,
        symbol: body.symbol,
        side: body.side,
        status: "filled",
        filled_qty: String(qty),
        filled_avg_price: String(price(body.symbol)),
        filled_at: new Date(START).toISOString(),
        updated_at: null,
      };
      orders.set(o.id, o);
      orders.set(o.client_order_id, o);
      return [200, o];
    }
    if (r.path.startsWith("/v2/orders:by_client_order_id")) {
      const o = orders.get(new URL(`http://x${r.path}`).searchParams.get("client_order_id") ?? "");
      return o ? [200, o] : [404, { message: "not found" }];
    }
    if (r.path.startsWith("/v2/orders/")) {
      const o = orders.get(r.path.split("/").pop() ?? "");
      return o ? [200, o] : [404, { message: "not found" }];
    }
    if (r.path === "/v2/positions") {
      const list = [...held].filter(([, p]) => p.qty > 1e-12);
      return [
        200,
        list.map(([symbol, p]) => ({
          symbol,
          asset_class: symbol.endsWith("USD") && symbol.length > 5 ? "crypto" : "us_equity",
          qty: String(p.qty),
          avg_entry_price: String(p.avg),
        })),
      ];
    }
    if (r.path === "/v2/account") {
      return [200, { equity: "100000", cash: "100000", non_marginable_buying_power: "100000" }];
    }
    return [404, { message: "?" }];
  });
  const setPosition = (symbol: string, qty: number, avg?: number) =>
    held.set(symbol.replace("/", ""), { qty, avg: avg ?? price(symbol) });
  return { ...srv, setPosition };
}

function alpacaEngine(url: string, clock = new SimClock(START)) {
  const engine = new Engine({
    home: tmpHome(),
    dbFile: ":memory:",
    clock,
    provider: new SyntheticData(new UsEquityCalendar()),
    alpacaBaseUrl: url,
  });
  const account = engine.saveAccount({
    name: "Paper",
    broker: "alpaca",
    keyId: "K",
    secretKey: "S",
  });
  return { engine, account, clock };
}

function simEngine(clock: SimClock | TestClock = new SimClock(START), provider?: BarProvider) {
  const engine = new Engine({
    home: tmpHome(),
    dbFile: ":memory:",
    clock,
    provider: provider ?? new SyntheticData(new UsEquityCalendar()),
  });
  const account = engine.saveAccount({ name: "Sim", broker: "sim", startingCash: 100_000 });
  return { engine, account };
}

function heartbeat(engine: Engine, accountId: string, symbols = ["BTC/USD"], name = "HB") {
  return engine.createBot({
    name,
    strategyId: "heartbeat",
    params: {},
    symbols,
    timeframe: "5m",
    accountId,
    dollarsPerTrade: 1000,
    risk: noRisk,
  }).bot;
}

describe("positions stay true to the broker", () => {
  test("stopping with 'close positions' sells what Alpaca holds after its coin fee", async () => {
    const srv = fakeAlpaca();
    try {
      const { engine, account } = alpacaEngine(srv.url);
      const bot = heartbeat(engine, account.id);
      await engine.orders.submit({
        bot,
        symbol: "BTC/USD",
        side: "buy",
        notional: 1000,
        refTs: START,
        decisionId: null,
        reason: "signal",
      });
      await engine.stopBot(bot.id, true);
      const sell = engine.store.listOrders({ botId: bot.id }).find((o) => o.side === "sell");
      expect(sell?.status).toBe("filled");
      expect(sell?.qty).toBeCloseTo(0.01 * 0.9975, 10);
      const [trade] = engine.store.listTrades({ botId: bot.id });
      expect(trade?.status).toBe("closed");
      // $2.50 of coin on the buy plus the 0.25% dollar fee on the sell.
      expect(trade?.pnlUsd).toBeCloseTo(-2.5 - 997.5 * 0.0025, 3);
    } finally {
      srv.stop();
    }
  });

  test("a position sold outside Exva is closed at the next exit and the bot keeps trading", async () => {
    const srv = fakeAlpaca();
    try {
      const { engine, account, clock } = alpacaEngine(srv.url);
      const bot = heartbeat(engine, account.id);
      const tick = async (t: number) => {
        clock.set(t);
        await engine.bars.sync(["BTC/USD"], "5m", t, 50);
        await engine.orders.sync();
        return engine.runner.tick(bot, "BTC/USD", t);
      };
      expect((await tick(START))?.kind).toBe("buy");
      srv.setPosition("BTC/USD", 0); // sold in Alpaca's dashboard
      const gone = await tick(START + 300_000);
      expect(gone?.code).toBe("position_gone");
      const [trade] = engine.store.listTrades({ botId: bot.id });
      expect(trade?.exitReason).toBe("closed_outside_exva");
      expect((await tick(START + 600_000))?.kind).toBe("buy"); // not frozen
    } finally {
      srv.stop();
    }
  });

  test("reconcile closes a vanished position only after it is missing a minute apart", async () => {
    const srv = fakeAlpaca();
    try {
      const { engine, account, clock } = alpacaEngine(srv.url);
      const bot = heartbeat(engine, account.id);
      const order = { bot, symbol: "BTC/USD", side: "buy" as const, notional: 1000 };
      await engine.orders.submit({ ...order, refTs: START, decisionId: null, reason: "signal" });
      srv.setPosition("BTC/USD", 0);
      await engine.scheduler.reconcile();
      expect(engine.store.openTrade(bot.id, "BTC/USD")).not.toBeNull();
      clock.set(START + 61_000);
      await engine.scheduler.reconcile();
      expect(engine.store.openTrade(bot.id, "BTC/USD")).toBeNull();
    } finally {
      srv.stop();
    }
  });

  test("a stock split adjusts the position; selling part outside Exva only warns", async () => {
    const srv = fakeAlpaca();
    try {
      const { engine, account } = alpacaEngine(srv.url);
      const bot = heartbeat(engine, account.id, ["SPY"]);
      const order = { bot, symbol: "SPY", side: "buy" as const, notional: 1000 };
      await engine.orders.submit({ ...order, refTs: START, decisionId: null, reason: "signal" });
      srv.setPosition("SPY", 1); // half sold outside Exva: same cost basis
      await engine.scheduler.reconcile();
      expect(engine.store.openTrade(bot.id, "SPY")?.qty).toBe(2);
      expect(engine.store.listEvents({ kind: "position_drift" }).length).toBe(1);
      srv.setPosition("SPY", 8, 125); // 4-for-1 split
      await engine.scheduler.reconcile();
      const t = engine.store.openTrade(bot.id, "SPY");
      expect(t?.qty).toBe(8);
      expect(t?.entryPrice).toBe(125);
      expect(engine.store.listEvents({ kind: "stock_split" }).length).toBe(1);
    } finally {
      srv.stop();
    }
  });

  test("split detection", () => {
    expect(splitRatio("NVDA", 10)).toBe(10);
    expect(splitRatio("XYZ", 0.1)).toBe(0.1);
    expect(splitRatio("SPY", 1.5)).toBeNull();
    expect(splitRatio("SPY", 0.5)).toBe(0.5);
    expect(splitRatio("BTC/USD", 2)).toBeNull();
  });
});

describe("bot changes can't strand a position", () => {
  test("moving a holding bot to another account or dropping a held symbol is refused", async () => {
    const { engine, account } = simEngine();
    const other = engine.saveAccount({ name: "B", broker: "sim", startingCash: 100_000 });
    const bot = heartbeat(engine, account.id, ["BTC/USD", "ETH/USD"]);
    await engine.bars.sync(["BTC/USD"], "5m", START, 50);
    expect((await engine.runner.tick(bot, "BTC/USD", START))?.kind).toBe("buy");
    expect(() => engine.updateBot(bot.id, { accountId: other.id })).toThrow("before moving it");
    expect(() => engine.updateBot(bot.id, { symbols: ["ETH/USD"] })).toThrow("still holds BTC/USD");
    expect(engine.updateBot(bot.id, { symbols: ["BTC/USD"] }).bot.symbols).toEqual(["BTC/USD"]);
  });

  test("deleting a bot with a working order is refused; stopping cancels its entry orders", async () => {
    const { engine, account } = simEngine();
    const bot = heartbeat(engine, account.id);
    await engine.bars.sync(["BTC/USD"], "5m", START, 50);
    await engine.runner.tick(bot, "BTC/USD", START); // the fill needs a bar that hasn't closed yet
    expect(engine.store.activeOrders().length).toBe(1);
    expect(() => engine.deleteBot(bot.id)).toThrow("orders working");
    await engine.stopBot(bot.id);
    expect(engine.store.activeOrders().length).toBe(0);
    expect(engine.store.listOrders({ botId: bot.id })[0]?.status).toBe("canceled");
    engine.deleteBot(bot.id);
    expect(engine.store.getBot(bot.id)).toBeNull();
  });
});

describe("guards count orders that are still working", () => {
  test("max positions holds across symbols checked on the same bar", async () => {
    const bt = await runBacktest(
      spec({
        symbols: ["BTC/USD", "ETH/USD", "SOL/USD"],
        risk: { ...noRisk, maxPositions: 1 },
        to: T0 + DAY / 4,
      }),
      synthEnv(),
    );
    const moves = bt.trades.flatMap((t) => [
      [t.openedAt, 1],
      [t.closedAt ?? Number.POSITIVE_INFINITY, -1],
    ]);
    moves.sort(
      (a, b) => (a[0] as number) - (b[0] as number) || (a[1] as number) - (b[1] as number),
    );
    let open = 0;
    let most = 0;
    for (const [, d] of moves) {
      open += d as number;
      most = Math.max(most, open);
    }
    expect(bt.trades.length).toBeGreaterThan(10);
    expect(most).toBe(1);
    expect(bt.decisionCounts.some((c) => c.code === "max_positions")).toBe(true);
  });

  test("two bots on one symbol and account never hold it at the same time", async () => {
    const clock = new TestClock(T0 + 70_000);
    const { engine, account } = simEngine(clock);
    const a = heartbeat(engine, account.id, ["BTC/USD"], "A");
    const b = heartbeat(engine, account.id, ["BTC/USD"], "B");
    await engine.startBot(a.id);
    await engine.startBot(b.id);
    await engine.start();
    await clock.runUntil(T0 + 3_600_000);
    engine.stop();
    const ta = engine.store.listTrades({ botId: a.id, limit: 1000 });
    const tb = engine.store.listTrades({ botId: b.id, limit: 1000 });
    const overlap = ta.filter((x) =>
      tb.some(
        (y) =>
          y.openedAt < (x.closedAt ?? Number.POSITIVE_INFINITY) &&
          x.openedAt < (y.closedAt ?? Number.POSITIVE_INFINITY),
      ),
    );
    expect(ta.length + tb.length).toBeGreaterThan(3);
    expect(overlap.length).toBe(0);
    const owned = engine.store
      .decisionCounts(null, 0)
      .find((c) => c.code === "symbol_owned_by_other_bot");
    expect(owned?.count ?? 0).toBeGreaterThan(0);
  }, 30_000);
});

/** Synthetic data that can be held back or made to fail for chosen symbols. */
class ControlledData implements BarProvider {
  readonly name = "synthetic";
  private readonly inner = new SyntheticData(new UsEquityCalendar());
  gate: Promise<void> | null = null;
  failing = new Set<string>();
  async fetchBars(symbols: string[], tf: Timeframe, from: number, to: number) {
    if (this.gate) await this.gate;
    const bad = symbols.find((s) => this.failing.has(s));
    if (bad) throw new DataError(`No data for ${bad}`);
    return this.inner.fetchBars(symbols, tf, from, to);
  }
}

describe("scheduler", () => {
  async function setup(symbols = ["BTC/USD"]) {
    const data = new ControlledData();
    const clock = new SimClock(START - 60_000);
    const { engine, account } = simEngine(clock, data);
    const bot = heartbeat(engine, account.id, symbols);
    await engine.startBot(bot.id);
    await engine.bars.sync(symbols, "5m", START - 60_000, 50); // the start-up backfill
    clock.set(START + 5_000); // the bar closing at START still has to be fetched
    let release = () => {};
    const hold = () => {
      data.gate = new Promise((r) => {
        release = () => {
          data.gate = null;
          r();
        };
      });
    };
    return { engine, bot, data, hold, release: () => release() };
  }

  test("a slow check doesn't pile up: the next bar records check_overrun", async () => {
    const { engine, bot, hold, release } = await setup();
    hold();
    const slow = engine.scheduler.runDue(START);
    await engine.scheduler.runDue(START + 300_000);
    release();
    await slow;
    const decisions = engine.store.listDecisions(bot.id, { limit: 10 });
    expect(decisions.find((d) => d.barTs === START + 300_000)?.code).toBe("check_overrun");
    expect(decisions.find((d) => d.barTs === START)?.kind).toBe("buy");
  });

  test("one failing symbol doesn't fail the others", async () => {
    const { engine, bot, data } = await setup(["BTC/USD", "ETH/USD"]);
    data.failing.add("ETH/USD");
    await engine.scheduler.runDue(START);
    const bySymbol = new Map(engine.store.listDecisions(bot.id, {}).map((d) => [d.symbol, d]));
    expect(bySymbol.get("BTC/USD")?.kind).toBe("buy");
    expect(bySymbol.get("ETH/USD")?.code).toBe("data_fetch_failed");
  });

  test("a bot stopped while its bars load makes no decisions", async () => {
    const { engine, bot, hold, release } = await setup();
    hold();
    const run = engine.scheduler.runDue(START);
    await engine.stopBot(bot.id);
    release();
    await run;
    expect(engine.store.listDecisions(bot.id, {}).length).toBe(0);
    expect(engine.store.activeOrders().length).toBe(0);
  });
});

describe("data", () => {
  test("simulator accounts mark positions with the newest bar of any timeframe", () => {
    const { engine } = simEngine();
    const bar = (ts: number, c: number): Bar => ({ ts, o: c, h: c, l: c, c, v: 1 });
    engine.store.upsertBars("BTC/USD", "5m", "synthetic", [bar(START - 3 * 3_600_000, 100)]);
    engine.store.upsertBars("BTC/USD", "1h", "synthetic", [bar(START - 3_600_000, 200)]);
    const prices = engine["simPrices"]();
    expect(prices.lastClose("BTC/USD", START)).toBe(200);
  });

  test("backtests fetch a missing tail even when it is shorter than three days", async () => {
    const env = synthEnv(T0 + 30 * DAY);
    env.clock.set(T0 + 28 * DAY);
    await env.bars.ensureRange(["BTC/USD"], "15m", T0, T0 + 28 * DAY);
    env.clock.set(T0 + 30 * DAY);
    const bt = await runBacktest(
      spec({ timeframe: "15m", from: T0 + 20 * DAY, to: T0 + 30 * DAY }),
      env,
    );
    expect(bt.equity.at(-1)?.ts).toBeGreaterThan(T0 + 29.9 * DAY);
  });
});
