import { z } from "zod";
import { AiError } from "../errors.ts";
import { round } from "../util.ts";
import { ALL_TIMEFRAMES, type Signal, type Strategy } from "./types.ts";

export const analystOutputSchema = z.object({
  action: z.enum(["buy", "sell", "hold"]),
  confidence: z.number().min(0).max(1),
  stopLossPct: z.number().min(0.1).max(20).nullable().optional(),
  takeProfitPct: z.number().min(0.1).max(50).nullable().optional(),
  reasoning: z.string().min(1).max(600),
});

const params = z.object({
  instructions: z
    .string()
    .max(2000)
    .default(
      "Swing trader. Buy strength on pullbacks inside an uptrend; sell when the trend breaks or the move is exhausted. Prefer holding cash over forcing trades.",
    )
    .meta({
      title: "Trading style",
      description: "Plain-English instructions for the AI. This is your strategy.",
    }),
  minConfidence: z
    .number()
    .min(0)
    .max(1)
    .default(0.6)
    .meta({ title: "Minimum confidence", description: "Buys below this confidence become holds." }),
  maxCallsPerDay: z.number().int().min(1).max(2000).default(100).meta({
    title: "Max AI calls per day",
    description: "Hard cap for this bot, on top of the daily budget.",
  }),
});

export const aiAnalyst: Strategy<z.infer<typeof params>> = {
  id: "ai-analyst",
  name: "AI Analyst",
  description:
    "Asks the AI model once per closed bar whether to buy, sell or hold, using recent bars, indicators, your position and your trading-style instructions. The engine still enforces sizing, guards and exits.",
  params,
  timeframes: ALL_TIMEFRAMES,
  defaultTimeframe: "1h",
  defaultSymbols: ["AAPL", "MSFT", "NVDA", "AMZN", "META"],
  usesAi: true,
  warmup: () => 60,
  async decide(ctx): Promise<Signal> {
    if (!ctx.ai) throw new AiError("AI is not configured. Add an API key in Settings.");
    const { output, callId } = await ctx.ai.analyze({
      botId: ctx.botId,
      symbol: ctx.symbol,
      timeframe: ctx.timeframe,
      bars: ctx.bars,
      position: ctx.position,
      instructions: ctx.params.instructions,
      maxCallsPerDay: ctx.params.maxCallsPerDay,
      now: ctx.now,
    });
    const conf = round(output.confidence, 2);
    const values = { confidence: conf };
    const why = output.reasoning;
    if (output.action === "buy") {
      if (ctx.position)
        return {
          action: "hold",
          reason: `AI says buy, already holding: ${why}`,
          values,
          aiCallId: callId,
        };
      if (conf < ctx.params.minConfidence) {
        return {
          action: "hold",
          code: "low_confidence",
          reason: `AI wants to buy at ${conf} confidence, below your ${ctx.params.minConfidence} minimum: ${why}`,
          values: { ...values, distance: round((ctx.params.minConfidence - conf) * 100, 1) },
          aiCallId: callId,
        };
      }
      return {
        action: "buy",
        reason: `AI (${conf}): ${why}`,
        values,
        stopLossPct: output.stopLossPct ?? null,
        takeProfitPct: output.takeProfitPct ?? null,
        aiCallId: callId,
      };
    }
    if (output.action === "sell") {
      if (!ctx.position)
        return {
          action: "hold",
          reason: `AI says sell, nothing held: ${why}`,
          values,
          aiCallId: callId,
        };
      return { action: "sell", reason: `AI (${conf}): ${why}`, values, aiCallId: callId };
    }
    return { action: "hold", reason: `AI: ${why}`, values, aiCallId: callId };
  },
};
