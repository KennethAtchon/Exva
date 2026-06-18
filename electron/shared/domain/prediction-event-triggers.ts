/** Candidate prediction-market trigger families (see docs/TODO.md §0.4). */
export type PredictionEventTriggerKind =
  | "odds_volume_dislocation"
  | "curated_event_feed"
  | "social_spike"
  | "hybrid_confirmation";
