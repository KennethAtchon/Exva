import { z } from "zod";

/**
 * Structured outputs for the prediction-market Forecaster + Red Team pipeline
 * (Part C). The LLM workers research a market and produce a probability; the
 * deterministic edge gate downstream turns those into a trade. The LLM never
 * sizes — it only forms the view.
 *
 * These payloads are carried through the pipeline in the `rawSummary` field of
 * the standard fundamental/review signals (the framework's escape hatch for
 * structured data), then parsed back by the deterministic decision engine.
 */

export const informationFreshnessSchema = z.enum([
  "fresh",
  "partially_priced",
  "stale",
]);

export const predictionEvidenceItemSchema = z.object({
  claim: z.string(),
  sourceUrl: z.string().nullable().default(null),
  publishedAt: z.string().nullable().default(null),
  /** How much weight the source deserves, [0,1]. */
  credibility: z.number().min(0).max(1).default(0.5),
  /** Whether it points toward YES (>0) or NO (<0) resolution, [-1,1]. */
  direction: z.number().min(-1).max(1).default(0),
});

/** Forecaster output: a researched probability of YES resolution. */
export const predictionForecastSchema = z.object({
  /** Estimated probability of YES resolution, [0,1]. */
  pHat: z.number().min(0).max(1),
  /** 1-sigma uncertainty on pHat, in bps (e.g. 800 = 8%). */
  uncertaintyBps: z.number().min(0).default(1500),
  informationFreshness: informationFreshnessSchema.default("fresh"),
  keyDrivers: z.array(z.string()).default([]),
  evidence: z.array(predictionEvidenceItemSchema).default([]),
  reasoning: z.string().default(""),
});
export type PredictionForecast = z.infer<typeof predictionForecastSchema>;

/** Red-team output: an adversarial re-estimate after hunting disconfirming evidence. */
export const predictionRedTeamSchema = z.object({
  /** The red team's own probability of YES resolution, [0,1]. */
  pHat: z.number().min(0).max(1),
  uncertaintyBps: z.number().min(0).default(1500),
  /** Strongest evidence the forecaster under-weighted, for the audit trail. */
  disconfirmingEvidence: z.array(z.string()).default([]),
  /** True if the red team judges the catalyst already priced into the market. */
  alreadyPricedIn: z.boolean().default(false),
  reasoning: z.string().default(""),
});
export type PredictionRedTeam = z.infer<typeof predictionRedTeamSchema>;

/** Discriminated payloads stashed in `rawSummary` so the decision engine can recover them. */
export const PREDICTION_FORECAST_KIND = "pm-forecast" as const;
export const PREDICTION_RED_TEAM_KIND = "pm-red-team" as const;

export function encodeForecastSummary(forecast: PredictionForecast): string {
  return JSON.stringify({ kind: PREDICTION_FORECAST_KIND, ...forecast });
}

export function encodeRedTeamSummary(redTeam: PredictionRedTeam): string {
  return JSON.stringify({ kind: PREDICTION_RED_TEAM_KIND, ...redTeam });
}

export function decodeForecastSummary(
  rawSummary: string | null | undefined,
): PredictionForecast | null {
  return decode(rawSummary, PREDICTION_FORECAST_KIND, predictionForecastSchema);
}

export function decodeRedTeamSummary(
  rawSummary: string | null | undefined,
): PredictionRedTeam | null {
  return decode(rawSummary, PREDICTION_RED_TEAM_KIND, predictionRedTeamSchema);
}

function decode<S extends z.ZodTypeAny>(
  rawSummary: string | null | undefined,
  kind: string,
  schema: S,
): z.infer<S> | null {
  if (!rawSummary) return null;
  try {
    const parsed = JSON.parse(rawSummary) as { kind?: unknown };
    if (parsed?.kind !== kind) return null;
    return schema.parse(parsed) as z.infer<S>;
  } catch {
    return null;
  }
}
