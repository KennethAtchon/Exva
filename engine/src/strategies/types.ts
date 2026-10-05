import type { Bar, Timeframe } from "@shared/types.ts";
import type { z } from "zod";

export interface PositionView {
  qty: number;
  entryPrice: number;
  openedAt: number;
  barsHeld: number;
  unrealizedPct: number;
}

/** AI access for strategies that declare `usesAi`. Implemented in engine/src/ai/analyst.ts. */
export interface AnalystAi {
  analyze(input: {
    botId: string;
    symbol: string;
    timeframe: Timeframe;
    bars: Bar[];
    position: PositionView | null;
    instructions: string;
    maxCallsPerDay: number;
    now: number;
  }): Promise<{ output: AnalystOutput; callId: string }>;
}

export interface AnalystOutput {
  action: "buy" | "sell" | "hold";
  confidence: number;
  stopLossPct?: number | null;
  takeProfitPct?: number | null;
  reasoning: string;
}

export interface StrategyContext<P> {
  botId: string;
  symbol: string;
  timeframe: Timeframe;
  /** Closed bars only, oldest first. The last one is the bar that just closed. */
  bars: Bar[];
  position: PositionView | null;
  params: P;
  /** Close time of the last bar (simulated time in backtests). Never use Date.now() in a strategy. */
  now: number;
  ai: AnalystAi | null;
}

/**
 * `values` must hold the numbers the condition compared, so the UI can say "RSI(2) 11.8, buys below 10".
 * `values.distance` (>= 0, in %) says how far a flat bot is from an entry; the summary shows the smallest.
 */
export type Signal =
  | {
      action: "buy" | "sell";
      reason: string;
      values?: Record<string, number>;
      stopLossPct?: number | null;
      takeProfitPct?: number | null;
      aiCallId?: string;
    }
  | {
      action: "hold";
      reason: string;
      values?: Record<string, number>;
      code?: "no_signal" | "low_confidence";
      aiCallId?: string;
    };

export interface Strategy<P = Record<string, unknown>> {
  id: string;
  name: string;
  description: string;
  params: z.ZodType<P>;
  timeframes: Timeframe[];
  defaultTimeframe: Timeframe;
  defaultSymbols: string[];
  isTest?: boolean;
  usesAi?: boolean;
  warmup(params: P): number;
  decide(ctx: StrategyContext<P>): Signal | Promise<Signal>;
}

export const ALL_TIMEFRAMES: Timeframe[] = ["5m", "15m", "1h"];
