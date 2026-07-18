import { safeJsonParse } from "../../infra/safe-json-parse";

export function formatMinutesLabel(minutes: number): string {
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

export function remapPredictionMetadataForOutcome(
  raw: string | null,
  predictionOutcome: "YES" | "NO" | null,
): string | null {
  if (!raw || !predictionOutcome) return raw;
  const parsed = safeJsonParse<{
    yesOutcomeTokenId?: string;
    noOutcomeTokenId?: string;
    outcomeTokenId?: string;
  }>(raw, undefined, "remapPredictionMetadataForOutcome");
  if (!parsed) return raw;
  const outcomeTokenId =
    predictionOutcome === "YES"
      ? parsed.yesOutcomeTokenId
      : parsed.noOutcomeTokenId;
  return JSON.stringify({
    ...parsed,
    outcomeTokenId: outcomeTokenId ?? parsed.outcomeTokenId,
  });
}
