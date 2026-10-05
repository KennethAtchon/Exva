// The AI Analyst strategy's single call per check. Context is built only from closed bars and the
// bot's position, so identical inputs produce identical prompts (replayable, cacheable).
import type { Bar } from "@shared/types.ts";
import { assetClassOf } from "@shared/types.ts";
import type { Clock } from "../core/clock.ts";
import { AiBudgetError } from "../errors.ts";
import type { Store } from "../store/store.ts";
import { analystOutputSchema } from "../strategies/ai-analyst.ts";
import { atr, last, pctChange, rsi, sma } from "../strategies/indicators.ts";
import type { AnalystAi, AnalystOutput } from "../strategies/types.ts";
import { fmtNum, localDayStart, round, sha256 } from "../util.ts";
import { type AiClient, promptVersion } from "./client.ts";
import analystPrompt from "./prompts/analyst.md" with { type: "text" };

export const ANALYST_VERSION = promptVersion(analystPrompt);

type AnalyzeInput = Parameters<AnalystAi["analyze"]>[0];

const utc = (ts: number) => new Date(ts).toISOString().slice(0, 16).replace("T", " ");

export function analystContext(input: AnalyzeInput): string {
  const { bars, position } = input;
  const closes = bars.map((b) => b.c);
  const lastBar = bars[bars.length - 1] as Bar;
  const a = last(atr(bars, 14));
  const pos = position
    ? `long ${round(position.qty, 6)} @ ${fmtNum(position.entryPrice)} (held ${position.barsHeld} bars, ${position.unrealizedPct >= 0 ? "+" : ""}${position.unrealizedPct}%)`
    : "flat";
  const rows = bars
    .slice(-50)
    .map(
      (b) =>
        `${utc(b.ts)},${fmtNum(b.o)},${fmtNum(b.h)},${fmtNum(b.l)},${fmtNum(b.c)},${Math.round(b.v)}`,
    );
  return [
    `Symbol: ${input.symbol} (${assetClassOf(input.symbol)}) | Timeframe: ${input.timeframe} | Bar closed: ${utc(input.now)} UTC`,
    `Position: ${pos}`,
    `Indicators on the last bar: close ${fmtNum(lastBar.c)} | RSI14 ${round(last(rsi(closes, 14)), 1)} | SMA20 ${fmtNum(last(sma(closes, 20)))} | SMA50 ${fmtNum(last(sma(closes, 50)))} | ATR14 ${fmtNum(a)} (${round((a / lastBar.c) * 100, 2)}%) | change 1 bar ${round(pctChange(bars, 1), 2)}%, 24 bars ${round(pctChange(bars, 24), 2)}%`,
    "Last 50 bars, oldest first (time UTC, open, high, low, close, volume):",
    ...rows,
  ].join("\n");
}

function request(input: AnalyzeInput) {
  const system = `${analystPrompt}\n\nTrading style:\n${input.instructions || "(none)"}`;
  const user = analystContext(input);
  return {
    messages: [
      { role: "system" as const, content: system },
      { role: "user" as const, content: user },
    ],
    contextHash: sha256(`${system}\n${user}`),
    promptVersion: ANALYST_VERSION,
    schema: analystOutputSchema,
    maxTokens: 400,
  };
}

export class LiveAnalyst implements AnalystAi {
  constructor(private readonly d: { ai: AiClient; store: Store; clock: Clock }) {}

  async analyze(input: AnalyzeInput): Promise<{ output: AnalystOutput; callId: string }> {
    const used = this.d.store.aiCallCountSince(input.botId, localDayStart(this.d.clock.now()));
    if (used >= input.maxCallsPerDay) {
      throw new AiBudgetError(`This bot used its ${input.maxCallsPerDay} AI calls for today`);
    }
    const { data, callId } = await this.d.ai.json({
      purpose: "analyst",
      botId: input.botId,
      ...request(input),
    });
    return { output: data, callId };
  }
}

/** Backtest variant: answers are cached by context, and real (paid) calls are capped per run. */
export class BacktestAnalyst implements AnalystAi {
  calls = 0;
  costUsd = 0;

  constructor(
    private readonly ai: AiClient,
    private readonly maxCalls: number,
  ) {}

  async analyze(input: AnalyzeInput): Promise<{ output: AnalystOutput; callId: string }> {
    const req = request(input);
    const cached = this.ai.cached({ purpose: "backtest", ...req });
    if (cached) return { output: cached.data, callId: cached.callId };
    if (this.calls >= this.maxCalls)
      throw new AiBudgetError(`Backtest AI call cap of ${this.maxCalls} reached`);
    this.calls++;
    const res = await this.ai.json({
      purpose: "backtest",
      ...req,
      cache: true,
      budgetExempt: true,
    });
    this.costUsd += res.costUsd;
    return { output: res.data, callId: res.callId };
  }
}
