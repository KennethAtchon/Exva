/** Candidate prediction-market trigger families (see docs/TODO.md §0.4). */
export type PredictionEventTriggerKind =
  | "odds_volume_dislocation"
  | "curated_event_feed"
  | "social_spike"
  | "hybrid_confirmation";

export const PREDICTION_EVENT_TRIGGER_LABELS: Record<
  PredictionEventTriggerKind,
  string
> = {
  odds_volume_dislocation: "Polymarket odds/volume dislocation",
  curated_event_feed: "Curated event feed",
  social_spike: "Tweet/social spike (stub)",
  hybrid_confirmation:
    "Hybrid external-event + market-confirmation flow (stub)",
};
