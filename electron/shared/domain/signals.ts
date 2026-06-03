export type SignalSourceType = "edgar_8k" | "web_search" | "manual";

export function isSearchStyleSignalSourceType(type: SignalSourceType): boolean {
  return type === "web_search";
}

export function isSelfDescribingSignalSourceType(
  type: SignalSourceType,
): boolean {
  return type !== "web_search" && type !== "manual";
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
