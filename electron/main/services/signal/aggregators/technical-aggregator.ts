import { z } from "zod";
import {
  technicalSignalSchema,
  type TechnicalSignal,
} from "@electron/shared/ai/trade-signals";

export const chartPatternOutputSchema = z.object({
  patternName: z
    .string()
    .nullable()
    .default(null)
    .describe(
      'Standard pattern name (e.g. "bull flag", "double bottom"), or null if no clear pattern.',
    ),
  patternStrength: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .default(null)
    .describe(
      "Confidence the pattern is well-formed (0 = ambiguous, 1 = textbook).",
    ),
  nearestSupport: z
    .number()
    .nullable()
    .default(null)
    .describe("Nearest support price from visible structure, or null."),
  nearestResistance: z
    .number()
    .nullable()
    .default(null)
    .describe("Nearest resistance price from visible structure, or null."),
  rawSummary: z
    .string()
    .default("")
    .describe("One-to-two sentence observation."),
});
export type ChartPatternOutput = z.infer<typeof chartPatternOutputSchema>;

export const momentumOutputSchema = z.object({
  trendDirection: z
    .enum(["bullish", "bearish", "neutral"])
    .default("neutral")
    .describe("Dominant directional bias across recent bars."),
  trendStrength: z
    .number()
    .min(0)
    .max(1)
    .default(0)
    .describe(
      "How sustained and consistent the direction is (0 = none, 1 = strong).",
    ),
  momentumScore: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .default(null)
    .describe(
      "Combined RSI/MACD-style signal strength (0 = exhausted, 1 = strong continuation).",
    ),
  rawSummary: z
    .string()
    .default("")
    .describe("One-to-two sentence observation."),
});
export type MomentumOutput = z.infer<typeof momentumOutputSchema>;

export const volumeOutputSchema = z.object({
  volumeScore: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .default(null)
    .describe(
      "Relative volume strength (0 = below average, 1 = strong surge), or null.",
    ),
  volumeSignal: z
    .enum(["accumulation", "distribution", "neutral"])
    .nullable()
    .default(null)
    .describe(
      "accumulation (volume on up days), distribution (volume on down days), neutral, or null.",
    ),
  rawSummary: z
    .string()
    .default("")
    .describe("One-to-two sentence observation."),
});
export type VolumeOutput = z.infer<typeof volumeOutputSchema>;

export interface TechnicalWorkerOutputs {
  chartPattern?: ChartPatternOutput | null;
  momentum?: MomentumOutput | null;
  volume?: VolumeOutput | null;
}

export function aggregateTechnicalSignal(
  symbol: string,
  workers: TechnicalWorkerOutputs,
): TechnicalSignal {
  const trend = workers.momentum?.trendDirection ?? "neutral";
  const trendStrength = workers.momentum?.trendStrength ?? 0;
  const momentumScore = workers.momentum?.momentumScore ?? null;
  const volumeScore = workers.volume?.volumeScore ?? null;
  const volumeSignal = workers.volume?.volumeSignal ?? null;
  const patternName = workers.chartPattern?.patternName ?? null;
  const patternStrength = workers.chartPattern?.patternStrength ?? null;
  const nearestSupport = workers.chartPattern?.nearestSupport ?? null;
  const nearestResistance = workers.chartPattern?.nearestResistance ?? null;
  const timeframeAlignment = computeAlignment(trend, volumeSignal);
  const rawSummary = buildRawSummary(workers);

  return technicalSignalSchema.parse({
    symbol,
    trendDirection: trend,
    trendStrength,
    momentumScore,
    volumeScore,
    volumeSignal,
    patternName,
    patternStrength,
    nearestSupport,
    nearestResistance,
    timeframeAlignment,
    rawSummary,
  });
}

function computeAlignment(
  trend: string,
  volumeSignal: string | null,
): number | null {
  if (!volumeSignal) return null;
  if (trend === "bullish" && volumeSignal === "accumulation") return 1;
  if (trend === "bearish" && volumeSignal === "distribution") return 1;
  if (trend === "neutral" && volumeSignal === "neutral") return 1;
  if (trend === "neutral" || volumeSignal === "neutral") return 0.5;
  return 0;
}

function buildRawSummary(workers: TechnicalWorkerOutputs): string {
  const parts: string[] = [];
  if (workers.momentum?.rawSummary)
    parts.push(`Momentum: ${workers.momentum.rawSummary}`);
  if (workers.chartPattern?.rawSummary)
    parts.push(`Pattern: ${workers.chartPattern.rawSummary}`);
  if (workers.volume?.rawSummary)
    parts.push(`Volume: ${workers.volume.rawSummary}`);
  return parts.join(" | ");
}
