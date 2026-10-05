import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assistant, writeJournal } from "../src/ai/insights.ts";
import { UsEquityCalendar } from "../src/core/calendar.ts";
import { SimClock } from "../src/core/clock.ts";
import { SyntheticData } from "../src/data/synthetic.ts";
import { Engine } from "../src/engine.ts";
import { AiBudgetError, AiError } from "../src/errors.ts";
import { analystOutputSchema } from "../src/strategies/ai-analyst.ts";
import { completion, fakeServer } from "./fakes.ts";
import { DAY, noRisk, T0 } from "./helpers.ts";

let stop: () => void = () => {};
afterEach(() => stop());

function engineWithAi(handler: Parameters<typeof fakeServer>[0], now = T0 + 30 * DAY) {
  const srv = fakeServer(handler);
  stop = srv.stop;
  const engine = new Engine({
    home: mkdtempSync(join(tmpdir(), "exva-ai-")),
    dbFile: ":memory:",
    clock: new SimClock(now),
    provider: new SyntheticData(new UsEquityCalendar()),
  });
  engine.settings.patch({
    ai: { provider: "custom", baseUrl: srv.url, model: "deepseek-flash" },
    aiApiKey: "sk-test",
  });
  return { engine, srv };
}

const buyJson = JSON.stringify({
  action: "buy",
  confidence: 0.8,
  stopLossPct: 2,
  takeProfitPct: 4,
  reasoning: "Close above SMA20 with RSI14 56.",
});

describe("AI client", () => {
  test("valid JSON is returned, logged with DeepSeek token pricing", async () => {
    const { engine, srv } = engineWithAi(() => [200, completion(buyJson)]);
    const res = await engine.ai.json({
      purpose: "analyst",
      messages: [{ role: "user", content: "x" }],
      promptVersion: "v1",
      schema: analystOutputSchema,
    });
    expect(res.data.action).toBe("buy");
    const body = srv.requests[0]!.body as Record<string, unknown>;
    expect(body.model).toBe("deepseek-flash");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(srv.requests[0]!.path).toBe("/chat/completions");
    expect(srv.requests[0]!.headers.get("authorization")).toBe("Bearer sk-test");
    // 800 miss x $0.30/M + 200 hit x $0.006/M + 100 out x $1.20/M
    expect(engine.store.getAiCall(res.callId)?.costUsd).toBeCloseTo(
      (800 * 0.3 + 200 * 0.006 + 100 * 1.2) / 1e6,
      10,
    );
  });

  test("invalid output gets one repair attempt with the validation errors", async () => {
    let n = 0;
    const { engine, srv } = engineWithAi(() => [
      200,
      completion(n++ === 0 ? '{"action":"maybe"}' : buyJson),
    ]);
    const res = await engine.ai.json({
      purpose: "analyst",
      messages: [{ role: "user", content: "x" }],
      promptVersion: "v1",
      schema: analystOutputSchema,
    });
    expect(res.data.confidence).toBe(0.8);
    const repair = (
      srv.requests[1]!.body as { messages: { role: string; content: string }[] }
    ).messages.at(-1)!;
    expect(repair.content).toContain("action");
  });

  test("two invalid answers fail loudly; provider errors fail loudly", async () => {
    const { engine } = engineWithAi(() => [200, completion("not json")]);
    await expect(
      engine.ai.json({
        purpose: "analyst",
        messages: [],
        promptVersion: "v",
        schema: analystOutputSchema,
      }),
    ).rejects.toThrow(AiError);
    const { engine: e2 } = engineWithAi(() => [401, { error: "bad key" }]);
    await expect(
      e2.ai.complete({ purpose: "journal", messages: [], promptVersion: "v" }),
    ).rejects.toThrow("401");
  });

  test("the daily budget is enforced from the database before any request", async () => {
    const { engine, srv } = engineWithAi(() => [
      200,
      completion(buyJson, undefined, {
        prompt_tokens: 0,
        completion_tokens: 2_000_000,
        prompt_cache_hit_tokens: 0,
        prompt_cache_miss_tokens: 0,
      }),
    ]);
    await engine.ai.complete({ purpose: "journal", messages: [], promptVersion: "v" }); // costs $2.40, budget is $2
    await expect(
      engine.ai.complete({ purpose: "journal", messages: [], promptVersion: "v" }),
    ).rejects.toThrow(AiBudgetError);
    expect(srv.requests.length).toBe(1);
  });
});

describe("AI Analyst bot", () => {
  async function analystBot(engine: Engine) {
    const account = engine.saveAccount({ name: "Sim", broker: "sim", startingCash: 100_000 });
    return engine.createBot({
      name: "AI",
      strategyId: "ai-analyst",
      params: { minConfidence: 0.6 },
      symbols: ["BTC/USD"],
      timeframe: "1h",
      accountId: account.id,
      dollarsPerTrade: 500,
      risk: noRisk,
    }).bot;
  }

  test("a confident buy places an order and links the AI call", async () => {
    const { engine } = engineWithAi(() => [200, completion(buyJson)]);
    const bot = await analystBot(engine);
    const t = engine.clock.now();
    await engine.bars.sync(["BTC/USD"], "1h", t, 200);
    const d = await engine.runner.tick(bot, "BTC/USD", t);
    expect(d?.kind).toBe("buy");
    expect(d?.aiCallId).toBeTruthy();
    expect(engine.store.getOrder(d!.orderId!)?.stopPct).toBe(2);
  });

  test("low confidence becomes a hold; a failing provider becomes an error decision, not a crash", async () => {
    let mode = "low";
    const { engine } = engineWithAi(() =>
      mode === "low" ? [200, completion(buyJson.replace("0.8", "0.4"))] : [500, {}],
    );
    const bot = await analystBot(engine);
    const t = engine.clock.now();
    await engine.bars.sync(["BTC/USD"], "1h", t, 200);
    expect((await engine.runner.tick(bot, "BTC/USD", t))?.code).toBe("low_confidence");
    mode = "down";
    (engine.clock as SimClock).set(t + 3_600_000);
    await engine.bars.sync(["BTC/USD"], "1h", t + 3_600_000, 200);
    const d = await engine.runner.tick(bot, "BTC/USD", t + 3_600_000);
    expect(d?.kind).toBe("error");
    expect(d?.code).toBe("ai_failed");
  });

  test("AI backtests are capped and cached: a second run makes no new calls", async () => {
    const { engine, srv } = engineWithAi(() => [
      200,
      completion(JSON.stringify({ action: "hold", confidence: 0.5, reasoning: "Range-bound." })),
    ]);
    const spec = engine.backtestSpec({
      strategyId: "ai-analyst",
      params: {},
      symbols: ["BTC/USD"],
      timeframe: "1h",
      days: 2,
      startingCash: 100_000,
      dollarsPerTrade: 1000,
      slippageBps: 0,
      feeBps: 0,
      risk: noRisk,
      aiMaxCalls: 30,
    });
    const first = await engine.backtest(spec);
    expect(first.metrics?.aiCalls).toBe(30);
    expect(first.decisionCounts.find((c) => c.code === "ai_budget_exhausted")?.count).toBe(48 - 30);
    const calls = srv.requests.length;
    const second = await engine.backtest(spec);
    expect(second.metrics?.aiCalls).toBe(18); // only the bars the first run could not afford
    expect(srv.requests.length).toBe(calls + 18);
  });
});

describe("journal and assistant", () => {
  test("without an AI key the journal is still written from the numbers", async () => {
    const engine = new Engine({
      home: mkdtempSync(join(tmpdir(), "exva-j-")),
      dbFile: ":memory:",
      clock: new SimClock(T0),
    });
    const j = await writeJournal(engine);
    expect(j.text).toContain("Last 24 hours");
    expect(engine.store.listEvents({ kind: "journal" }).length).toBe(1);
  });

  test("the assistant reads state with tools and turns suggestions into proposals", async () => {
    let step = 0;
    const { engine } = engineWithAi(() => {
      step++;
      if (step === 1)
        return [
          200,
          completion(null, [
            { id: "c1", type: "function", function: { name: "get_status", arguments: "{}" } },
          ]),
        ];
      if (step === 2) {
        const args = JSON.stringify({
          label: "Run a 30-day test",
          action: "run_backtest",
          payload: { strategyId: "ema-cross" },
        });
        return [
          200,
          completion(null, [
            { id: "c2", type: "function", function: { name: "propose_action", arguments: args } },
          ]),
        ];
      }
      return [200, completion("Everything is healthy. I suggested a backtest.")];
    });
    const res = await assistant(engine, [{ role: "user", content: "How are things?" }]);
    expect(res.reply).toContain("healthy");
    expect(res.proposals).toEqual([
      { label: "Run a 30-day test", action: "run_backtest", payload: { strategyId: "ema-cross" } },
    ]);
  });
});
