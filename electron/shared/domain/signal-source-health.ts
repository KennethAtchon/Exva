import type { PollResult, SignalSourceRuntimeStatus } from "./signals";

/** Transport/parse outcome for one source poll. */
export type SignalSourcePollOutcome =
  | "success"
  | "http_error"
  | "parse_error"
  | "error";

export interface SignalSourceRuntimeState {
  sourceId: string;
  status: SignalSourceRuntimeStatus;
  lastPollAt: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  lastError: string | null;
  lastOutcome: SignalSourcePollOutcome | null;
  httpStatus: number | null;
  detected: number;
  passed: number;
  dropped: number;
  errors: string[];
  updatedAt: string;
}

export interface SignalSourcePollHistoryEntry {
  id: string;
  sourceId: string;
  polledAt: string;
  outcome: SignalSourcePollOutcome;
  httpStatus: number | null;
  detected: number;
  passed: number;
  dropped: number;
  dropReasons?: Record<string, number>;
  errors: string[];
  durationMs: number;
  status: SignalSourceRuntimeStatus;
}

export interface RecordSignalSourcePollInput {
  sourceId: string;
  polledAt: string;
  outcome: SignalSourcePollOutcome;
  httpStatus: number | null;
  result: PollResult;
  status: SignalSourceRuntimeStatus;
  lastError: string | null;
  durationMs: number;
}

/** Default: treat polls older than 45m as stale (covers 15m prediction cadence × 3). */
export const SOURCE_HEALTH_STALE_MS = 45 * 60 * 1000;

export function isSignalSourceRuntimeHealthy(
  state: Pick<
    SignalSourceRuntimeState,
    "status" | "lastSuccessAt" | "consecutiveFailures"
  > | null,
  nowMs = Date.now(),
  staleMs = SOURCE_HEALTH_STALE_MS,
): boolean {
  if (!state || state.status === "error" || state.consecutiveFailures > 0) {
    return false;
  }
  if (!state.lastSuccessAt) return false;
  const successMs = Date.parse(state.lastSuccessAt);
  return Number.isFinite(successMs) && nowMs - successMs <= staleMs;
}

export function classifyPollError(message: string): SignalSourcePollOutcome {
  const lower = message.toLowerCase();
  // Parse before status — messages often include both ("parse error (status 200)").
  if (lower.includes("parse") || lower.includes("json")) return "parse_error";
  if (/\bstatus\s+\d{3}\b/.test(lower) || lower.includes("http")) {
    return "http_error";
  }
  return "error";
}
