import { z } from "zod";

export const backtestDataGapSchema = z.object({
  from: z.string(),
  to: z.string(),
});

export const backtestDataQualityReportSchema = z.object({
  symbol: z.string(),
  timeframe: z.string(),
  windowStart: z.string(),
  windowEnd: z.string(),
  expectedBars: z.number().int().nonnegative(),
  actualBars: z.number().int().nonnegative(),
  missingIntervals: z.array(backtestDataGapSchema),
  duplicateTimestamps: z.number().int().nonnegative(),
  outOfOrderPairs: z.number().int().nonnegative(),
  provider: z.string().nullable(),
  /** Equity feed when provider is alpaca (e.g. iex). */
  feed: z.string().nullable(),
  /** True when stored coverage spans the requested window. */
  windowCovered: z.boolean(),
  complete: z.boolean(),
  /** Human-readable blockers when complete is false. */
  blockers: z.array(z.string()),
});

export type BacktestDataGap = z.infer<typeof backtestDataGapSchema>;
export type BacktestDataQualityReport = z.infer<
  typeof backtestDataQualityReportSchema
>;
