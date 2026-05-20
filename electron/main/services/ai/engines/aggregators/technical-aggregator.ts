import { z } from "zod";
import {
  technicalSignalSchema,
  type TechnicalSignal,
} from "@electron/shared/ai/pipeline-signals";

export const chartPatternOutputSchema = z.object({
  patternName: z.string().nullable().default(null),
  patternStrength: z.number().min(0).max(1).nullable().default(null),
  nearestSupport: z.number().nullable().default(null),
  nearestResistance: z.number().nullable().default(null),
  rawSummary: z.string().default(""),
});
export type ChartPatternOutput = z.infer<typeof chartPatternOutputSchema>;

export const momentumOutputSchema = z.object({
  trendDirection: z.enum(["bullish", "bearish", "neutral"]).default("neutral"),
  trendStrength: z.number().min(0).max(1).default(0),
  momentumScore: z.number().min(0).max(1).nullable().default(null),
  rawSummary: z.string().default(""),
});
export type MomentumOutput = z.infer<typeof momentumOutputSchema>;

export const volumeOutputSchema = z.object({
  volumeScore: z.number().min(0).max(1).nullable().default(null),
  volumeSignal: z
    .enum(["accumulation", "distribution", "neutral"])
    .nullable()
    .default(null),
  rawSummary: z.string().default(""),
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
