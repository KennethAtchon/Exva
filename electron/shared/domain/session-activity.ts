/**
 * Live session activity model — "what is this session doing right now".
 * See docs/feature-requests/session-activity-indicator.md.
 */

export type SessionActivitySeverity = "info" | "attention" | "warn" | "error";

export type SessionActivityConditionKind =
  | "cycle_running"
  | "waiting_signal"
  | "input_source_dead"
  | "data_feed_failing"
  | "calendar_misconfigured"
  | "selector_rejecting_all"
  | "degraded";

export interface SessionActivityCondition {
  kind: SessionActivityConditionKind;
  severity: SessionActivitySeverity;
  /** Plain-English explanation shown in the UI. */
  message: string;
  since: string;
  /** Occurrence count since `since`. */
  count: number;
  /** Optional pointer to an events-table row id for the "view evidence" link. */
  evidenceEventId?: string | null;
}

export interface SessionActivitySnapshot {
  sessionId: string;
  /** Present-tense human-readable current activity. */
  activity: string;
  conditions: SessionActivityCondition[];
  updatedAt: string;
}
