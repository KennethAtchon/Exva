export function formatMinutesLabel(minutes: number): string {
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
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
  const outcomeTokenId =
    predictionOutcome === "YES"
      ? parsed.yesOutcomeTokenId
      : parsed.noOutcomeTokenId;
  return JSON.stringify({
    ...parsed,
    outcomeTokenId: outcomeTokenId ?? parsed.outcomeTokenId,
  });
}
