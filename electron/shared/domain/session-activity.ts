/**
 * Live session activity model — "what is this session doing right now".
 * See docs/feature-requests/session-activity-indicator.md.
 */

export type SessionActivitySeverity = "info" | "attention" | "warn" | "error";

export type SessionActivityConditionKind =
  | "cycle_running"
  | "waiting_retry"
  | "waiting_signal"
  | "waiting_scan_tick"
  | "market_closed"
  | "symbol_locked"
  | "awaiting_approval"
  | "no_signal_stale"
  | "no_signal_went_quiet"
  | "input_source_dead"
  | "data_feed_failing"
  | "selector_rejecting_all"
  | "provider_degraded"
  | "spend_limit_near"
  | "spend_limit_hit"
  | "calendar_misconfigured"
  | "runtime_crash_loop"
  | "allocation_blocked"
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

export interface SessionActivityStats {
  cyclesRun: number;
  signalsReceived: number;
  tradesOpened: number;
  errors: number;
}

export interface SessionActivitySnapshot {
  sessionId: string;
  /** Present-tense human-readable current activity. */
  activity: string;
  conditions: SessionActivityCondition[];
  updatedAt: string;
  /** Counters since session start; computed on read, not persisted. */
  stats?: SessionActivityStats;
  /** Most recent cycle outcome summary; computed on read, not persisted. */
  lastCycleOutcome?: string | null;
}

export interface SessionActivityMonitoringHealth {
  healthy: boolean;
  lastSweepAt: string | null;
  /** Set when healthy is false — shown as a banner instead of stale green. */
  message: string | null;
}
