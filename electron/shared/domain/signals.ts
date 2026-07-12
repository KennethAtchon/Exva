export type LiveSignalSourceType =
  | "edgar_8k"
  | "manual"
  | "mock"
  | "prediction_event";

/** Persisted identity / dual-read only — not creatable or startable. */
export type DeprecatedSignalSourceType = "timer" | "web_search";

/** Persisted + dual-read; includes deprecated DB values. */
export type SignalSourceType =
  | LiveSignalSourceType
  | DeprecatedSignalSourceType;

const LIVE_SIGNAL_SOURCE_TYPES = new Set<string>([
  "edgar_8k",
  "manual",
  "mock",
  "prediction_event",
]);

const DEPRECATED_SIGNAL_SOURCE_TYPES = new Set<string>(["timer", "web_search"]);

export function isLiveSignalSourceType(t: string): t is LiveSignalSourceType {
  return LIVE_SIGNAL_SOURCE_TYPES.has(t);
}

export function isDeprecatedSignalSourceType(
  t: string,
): t is DeprecatedSignalSourceType {
  return DEPRECATED_SIGNAL_SOURCE_TYPES.has(t);
}

/**
 * Formerly true for `web_search`. Deprecated sources are never search-style.
 */
export function isSearchStyleSignalSourceType(type: SignalSourceType): boolean {
  void type;
  return false;
}

export function isSelfDescribingSignalSourceType(
  type: SignalSourceType,
): boolean {
  if (isDeprecatedSignalSourceType(type)) return false;
  return type !== "manual" && type !== "prediction_event";
}

/** True when the session must carry manual tickers / instrument scope. */
export function sessionRequiresInstrumentScope(
  subscribedSources: ReadonlyArray<{ type: SignalSourceType }>,
): boolean {
  const anySearchStyle = subscribedSources.some((source) =>
    isSearchStyleSignalSourceType(source.type),
  );
  return anySearchStyle || subscribedSources.length === 0;
}

export type SignalSourceRuntimeStatus =
  | "running"
  | "idle"
  | "paused"
  | "restarting"
  | "error";

export interface SignalEvent {
  id: string;
  sourceId: string;
  sourceType: SignalSourceType;
  ticker: string;
  companyName: string | null;
  documentUrl: string | null;
  accessionNumber: string | null;
  payloadJson: Record<string, unknown>;
  filedAt: string;
  detectedAt: string;
  /** MarketSignal kind (dual-write during envelope migration). */
  kind?: string | null;
  /** Typed payload JSON string or parsed object (dual-write). */
  payloadV2?: Record<string, unknown> | null;
  dedupeKey?: string | null;
  /** ISO-8601 duration; replaces hardcoded 4h pause expiry. */
  ttl?: string | null;
  occurredAt?: string | null;
}

export interface PollResult {
  detected: number;
  passed: number;
  dropped: number;
  errors: string[];
}

export interface SignalSourceRecord {
  id: string;
  type: SignalSourceType;
  name: string;
  description: string | null;
  enabled: boolean;
  /** Null for ad-hoc/user sources; set for experience-owned signal sources. */
  experienceId?: string | null;
  /** Instrument class this source produces; null for self-describing sources. */
  instrumentClass?: string | null;
  /** Timer poll gap (e.g. "15m"); how often the source re-evaluates — not the bar timeframe traded on. */
  pollCadence?: string | null;
  /** Bar timeframe the strategy trades on; drives OHLCV fetches for rules engines. */
  analysisTimeframe?: string | null;
  /** Denormalized from the owning experience's pipelineId. */
  pipelineId?: string | null;
  configJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionSignalDelivery {
  id: string;
  sessionId: string;
  signalEventId: string;
  sourceId: string;
  queuePositionAtEnqueue: number;
  status:
    | "queued"
    | "waiting_for_resume"
    | "processing"
    | "triggered"
    | "traded"
    | "rejected"
    | "dropped"
    | "expired";
  statusBucket: "pending" | "completed" | "dropped";
  enqueuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAt: string | null;
  tradeId: string | null;
  dropReason: string | null;
  notesJson: string | null;
}
