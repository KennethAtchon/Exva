export type LiveSignalSourceType =
  | "edgar_8k"
  | "manual"
  | "mock"
  | "prediction_event"
  | "kalshi_market"
  | "calendar"
  | "news_rss";

/** Canonical signal source type — live types only. */
export type SignalSourceType = LiveSignalSourceType;

const LIVE_SIGNAL_SOURCE_TYPES = new Set<string>([
  "edgar_8k",
  "manual",
  "mock",
  "prediction_event",
  "kalshi_market",
  "calendar",
  "news_rss",
]);

export function isLiveSignalSourceType(t: string): t is LiveSignalSourceType {
  return LIVE_SIGNAL_SOURCE_TYPES.has(t);
}

/**
 * Formerly true for `web_search` (removed). No live source is search-style.
 */
export function isSearchStyleSignalSourceType(type: SignalSourceType): boolean {
  void type;
  return false;
}

export function isSelfDescribingSignalSourceType(
  type: SignalSourceType,
): boolean {
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
  /** MarketSignal kind — required at emit time. */
  kind: string;
  /**
   * Legacy typed-payload column. Optional; payloadJson is canonical.
   * Kept for rows written during the dual-write period.
   */
  payloadV2?: Record<string, unknown> | null;
  /** Source-computed dedupe key — required at emit time. */
  dedupeKey: string;
  /** ISO-8601 duration TTL for delivery expiry — required at emit time. */
  ttl: string;
  /** When the information came into being — required at emit time. */
  occurredAt: string;
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
  configJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionSignalDelivery {
  id: string;
  sessionId: string;
  signalEventId: string;
  sourceId: string | null;
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
