import type { AiPipelineResult } from "./types";

export function formatMinutesLabel(minutes: number): string {
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export function instrumentCacheTtlMs(holdingStyle: string): number {
  switch (holdingStyle) {
    case "intraday_flat":
      return 30 * 60 * 1000;
    case "multi_day_swing":
      return 4 * 60 * 60 * 1000;
    case "weeks_position":
      return 24 * 60 * 60 * 1000;
    default:
      return 4 * 60 * 60 * 1000;
  }
}

export function sumAiPipelineCost(pipeline: AiPipelineResult): number {
  return Number(
    (
      pipeline.technical.run.cost_usd +
      pipeline.fundamental.run.cost_usd +
      pipeline.review.run.cost_usd +
      pipeline.decision.run.cost_usd
    ).toFixed(6),
  );
}

export function remapPredictionMetadataForOutcome(
  raw: string | null,
  predictionOutcome: "YES" | "NO" | null,
): string | null {
  if (!raw || !predictionOutcome) return raw;
  const parsed = JSON.parse(raw) as {
    yesOutcomeTokenId?: string;
    noOutcomeTokenId?: string;
    outcomeTokenId?: string;
  };
  const outcomeTokenId = predictionOutcome === "YES" ? parsed.yesOutcomeTokenId : parsed.noOutcomeTokenId;
  return JSON.stringify({ ...parsed, outcomeTokenId: outcomeTokenId ?? parsed.outcomeTokenId });
}

export function predictionResolutionScore(resolutionTime: string): number {
  const ms = new Date(resolutionTime).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  const days = ms / (1000 * 60 * 60 * 24);
  if (days <= 1) return 30;
  if (days <= 7) return 20;
  if (days <= 30) return 10;
  return 4;
}
