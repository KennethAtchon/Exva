import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Decision } from "@shared/types.ts";
import { routes, startApi } from "../src/api/server.ts";
import { runBacktest } from "../src/backtest/run.ts";
import { UsEquityCalendar } from "../src/core/calendar.ts";
import { SimClock } from "../src/core/clock.ts";
import { SyntheticData } from "../src/data/synthetic.ts";
import { Engine } from "../src/engine.ts";
import { TestClock } from "./fakes.ts";
import { DAY, noRisk, spec, synthEnv, T0 } from "./helpers.ts";

const tmpHome = () => mkdtempSync(join(tmpdir(), "exva-test-"));

describe("live scheduler", () => {
  test("PARITY: the live loop makes the same decisions as the backtester on the same bars", async () => {
    const start = T0 + 70_000; // past the catch-up window for the bar that closed at T0
    const clock = new TestClock(start);
    const engine = new Engine({
      home: tmpHome(),
      dbFile: ":memory:",
      clock,
      provider: new SyntheticData(new UsEquityCalendar()),
    });
    const account = engine.saveAccount({ name: "Sim", broker: "sim", startingCash: 100_000 });
    const heartbeat = engine.createBot({
      name: "HB",
      strategyId: "heartbeat",
      params: {},
      symbols: ["BTC/USD"],
      timeframe: "5m",
      accountId: account.id,
      dollarsPerTrade: 1000,
      risk: noRisk,
    }).bot;
    const trend = engine.createBot({
      name: "Trend",
      strategyId: "ema-cross",
      params: {},
      symbols: ["ETH/USD"],
      timeframe: "15m",
      accountId: account.id,
      dollarsPerTrade: 1000,
      risk: noRisk,
    }).bot;
    await engine.startBot(heartbeat.id);
    await engine.startBot(trend.id);
    await engine.start();
    const end = T0 + DAY;
    await clock.runUntil(end + 60_000);
    engine.stop();

    const strip = (d: Decision) => `${d.symbol} ${d.barTs} ${d.kind} ${d.code} ${d.message}`;
    for (const [bot, s] of [
      [
        heartbeat,
        spec({
          strategyId: "heartbeat",
          symbols: ["BTC/USD"],
          timeframe: "5m",
          to: end,
          slippageBps: 2,
        }),
      ],
      [
        trend,
        spec({
          strategyId: "ema-cross",
          symbols: ["ETH/USD"],
          timeframe: "15m",
          to: end,
          slippageBps: 2,
        }),
      ],
    ] as const) {
      const expected: Decision[] = [];
      await runBacktest(s, { ...synthEnv(), onDecision: (d) => expected.push(d) });
      const live = engine.store
        .listDecisions(bot.id, { limit: 10_000 })
        .filter((d) => d.barTs <= end)
        .reverse();
      expect(live.length).toBe(expected.length);
      expect(live.map(strip)).toEqual(expected.map(strip));
    }
    expect(engine.store.listTrades({ botId: heartbeat.id, status: "closed" }).length).toBe(143);
  }, 60_000);

  test("a restart resumes running bots and records the gap", async () => {
    const home = tmpHome();
    const db = join(home, "exva.db");
    const clock = new TestClock(T0);
    const first = new Engine({
      home,
      dbFile: db,
      clock,
      provider: new SyntheticData(new UsEquityCalendar()),
    });
    const acct = first.saveAccount({ name: "Sim", broker: "sim" });
    const bot = first.createBot({
      name: "HB",
      strategyId: "heartbeat",
      params: {},
      symbols: ["BTC/USD"],
      timeframe: "5m",
      accountId: acct.id,
      dollarsPerTrade: 100,
      risk: noRisk,
    }).bot;
    await first.startBot(bot.id);
    await first.start();
    await clock.runUntil(T0 + 3_600_000);
    first.stop();
    const before = first.store.listDecisions(bot.id, { limit: 1000 }).length;

    const later = new TestClock(T0 + 3 * 3_600_000); // "computer was asleep" for two hours
    const second = new Engine({
      home,
      dbFile: db,
      clock: later,
      provider: new SyntheticData(new UsEquityCalendar()),
    });
    await second.start();
    await later.runUntil(T0 + 4 * 3_600_000);
    second.stop();
    expect(second.store.getBot(bot.id)?.status).toBe("running");
    expect(second.store.listDecisions(bot.id, { limit: 1000 }).length).toBeGreaterThan(before + 10);
    const gap = second.store.listEvents({ kind: "sleep_gap" })[0];
    expect(gap?.data?.from).toBeLessThan(T0 + 3_600_000 + 61_000);
    expect(second.status().sleepGaps.length).toBe(1);
  }, 60_000);
});

describe("API", () => {
  const port = 17_000 + Math.floor(Math.random() * 2000);
  const engine = new Engine({
    home: tmpHome(),
    dbFile: ":memory:",
    clock: new SimClock(T0 + 60 * DAY),
    provider: new SyntheticData(new UsEquityCalendar()),
  });
  const server = startApi(engine, { port, token: "secret-token" });
  afterAll(() => server.stop(true));
  const call = async (method: string, path: string, body?: unknown, token = "secret-token") => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as never };
  };

  test("stays within the 30-endpoint budget", () => {
    const count = Object.values(routes(engine)).reduce(
      (n, methods) => n + Object.keys(methods).length,
      0,
    );
    expect(count).toBeLessThanOrEqual(30);
  });

  test("rejects requests without the token", async () => {
    expect((await call("GET", "/api/status", undefined, "wrong")).status).toBe(401);
  });

  test("account → bot → start → summary, with readable validation errors", async () => {
    const acct = (
      await call("POST", "/api/accounts", { name: "Sim", broker: "sim", startingCash: 50_000 })
    ).json as { id: string };
    const bad = await call("POST", "/api/bots", {
      name: "x",
      strategyId: "ema-cross",
      symbols: ["btc/usd"],
      timeframe: "15m",
      accountId: acct.id,
      dollarsPerTrade: 1000,
      risk: noRisk,
      params: { fast: 30, slow: 10 },
    });
    expect(bad.status).toBe(400);
    expect((bad.json as { error: string }).error).toContain("Fast EMA must be shorter");
    const created = await call("POST", "/api/bots", {
      name: "Trend",
      strategyId: "ema-cross",
      symbols: ["btc/usd"],
      timeframe: "15m",
      accountId: acct.id,
      dollarsPerTrade: 1000,
      risk: noRisk,
    });
    const bot = (
      created.json as { bot: { id: string; symbols: string[]; params: Record<string, number> } }
    ).bot;
    expect(bot.symbols).toEqual(["BTC/USD"]);
    expect(bot.params).toEqual({ fast: 9, slow: 21 });
    expect(
      ((await call("POST", `/api/bots/${bot.id}/start`)).json as { status: string }).status,
    ).toBe("running");
    const summary = (await call("GET", `/api/bots/${bot.id}/summary`)).json as {
      nextCheckAt: number;
    };
    expect(summary.nextCheckAt).toBeGreaterThan(T0);
  });

  test("strategies expose forms; preview and saved backtests work", async () => {
    const strategies = (await call("GET", "/api/strategies")).json as {
      id: string;
      params: { properties: Record<string, { title: string }> };
    }[];
    expect(strategies.find((s) => s.id === "rsi-dip")?.params.properties.buyBelow?.title).toBe(
      "Buy below",
    );
    const input = {
      strategyId: "rsi-dip",
      symbols: ["SPY"],
      timeframe: "15m",
      days: 10,
      risk: noRisk,
    };
    const preview = (await call("POST", "/api/preview", input)).json as {
      metrics: { trades: number };
    };
    expect(preview.metrics.trades).toBeGreaterThan(0);
    const { id } = (await call("POST", "/api/backtests", input)).json as { id: string };
    let bt: { status: string } = { status: "running" };
    for (let i = 0; i < 50 && bt.status === "running"; i++) {
      await Bun.sleep(50);
      bt = (await call("GET", `/api/backtests/${id}`)).json;
    }
    expect(bt.status).toBe("done");
  });

  test("settings hide the AI key; the kill switch shows in status", async () => {
    const s = (
      await call("PUT", "/api/settings", { aiApiKey: "sk-123", ai: { dailyBudgetUsd: 3 } })
    ).json as { ai: Record<string, unknown> };
    expect(s.ai.hasKey).toBe(true);
    expect(JSON.stringify(s)).not.toContain("sk-123");
    expect(s.ai.model).toBe("deepseek/deepseek-v4.1-flash");
    const status = (await call("POST", "/api/kill-switch", { on: true })).json as {
      killSwitch: boolean;
      health: string;
    };
    expect(status.killSwitch).toBe(true);
    expect(status.health).toBe("error");
  });
});
