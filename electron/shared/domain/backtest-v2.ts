import { z } from "zod";

const instrumentClassSchema = z.enum([
  "stock",
  "crypto",
  "futures",
  "options",
  "prediction_market",
]);

const tradingTimeframeSchema = z.enum([
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
  "1w",
]);

export const backtestEntryModelSchema = z.enum([
  "next_bar_open",
  "market_on_close",
]);

export const backtestSizingSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("fixed_notional"),
    notionalUsd: z.number().positive(),
  }),
  z.object({
    kind: z.literal("fraction_of_equity"),
    fraction: z.number().positive().max(1),
  }),
]);

export const backtestRunSpecV2Schema = z.object({
  schemaVersion: z.literal(2),
  experienceId: z.string(),
  strategy: z.object({
    id: z.string(),
    implementationVersion: z.number().int().positive(),
    parameters: z.record(z.unknown()),
  }),
  instruments: z
    .array(
      z.object({
        symbol: z.string(),
        instrumentClass: instrumentClassSchema,
        timeframe: tradingTimeframeSchema,
      }),
    )
    .min(1),
  window: z.object({ start: z.string(), end: z.string() }),
  folds: z.object({
    count: z.number().int().positive(),
    purgeBars: z.number().int().nonnegative(),
  }),
  portfolio: z.object({
    startingCapitalUsd: z.number().positive(),
    sizing: backtestSizingSchema,
    maxGrossExposureUsd: z.number().positive(),
    allowOverlappingPositions: z.boolean(),
  }),
  execution: z.object({
    entry: backtestEntryModelSchema,
    sameBarPriority: z.literal("stop_before_target"),
    endOfData: z.enum(["mark_open", "liquidate_at_close"]),
  }),
  costs: z.object({
    spreadBps: z.number().nonnegative(),
    commissionBps: z.number().nonnegative(),
    slippageBps: z.number().nonnegative(),
  }),
});

export type BacktestRunSpecV2 = z.infer<typeof backtestRunSpecV2Schema>;

export const backtestEquityPointSchema = z.object({
  ts: z.string(),
  cashUsd: z.number(),
  grossMarketValueUsd: z.number(),
  netMarketValueUsd: z.number(),
  realizedPnlUsd: z.number(),
  unrealizedPnlUsd: z.number(),
  feesUsd: z.number(),
  equityUsd: z.number(),
  drawdownUsd: z.number(),
  drawdownPct: z.number(),
});

export type BacktestEquityPoint = z.infer<typeof backtestEquityPointSchema>;

export const DEFAULT_BACKTEST_V2_PORTFOLIO = {
  startingCapitalUsd: 100_000,
  sizing: { kind: "fixed_notional" as const, notionalUsd: 500 },
  maxGrossExposureUsd: 100_000,
  allowOverlappingPositions: false,
};

export const DEFAULT_BACKTEST_V2_EXECUTION = {
  entry: "next_bar_open" as const,
  sameBarPriority: "stop_before_target" as const,
  endOfData: "mark_open" as const,
};
