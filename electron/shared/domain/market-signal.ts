import type { InstrumentClass } from "./enums";

/**
 * Typed information-bearing signal envelope (replaces EDGAR-shaped SignalEvent
 * as the canonical domain type). Timers are NOT a kind — they are schedules.
 */

export type MarketSignalKind =
  | "filing"
  | "market_dislocation"
  | "flow_anomaly"
  | "scan_hit"
  | "news"
  | "calendar_event"
  | "manual";

export interface MarketSignalBase {
  id: string;
  sourceId: string;
  kind: MarketSignalKind;
  instrumentClass: InstrumentClass;
  symbols: string[];
  occurredAt: string;
  detectedAt: string;
  /** ISO-8601 duration, e.g. "PT2H". Kind-specific staleness horizon. */
  ttl: string;
  /** Source-computed; enforced unique with sourceId. */
  dedupeKey: string;
  provenance: { url?: string; raw?: unknown };
}

export interface FilingPayload {
  filingType: string;
  accessionNumber: string;
  itemCodes: string[];
  companyName: string | null;
  documentUrl: string;
  filedAt: string;
  polarityHint?: "positive" | "negative" | "unclear";
}

export interface DislocationPayload {
  marketId: string;
  question: string;
  outcome: string;
  marketMid: number;
  spreadBps: number;
  liquidityUsd: number;
  resolutionAt: string;
  resolutionCriteria: string;
}

export interface FlowAnomalyPayload {
  underlying: string;
  anomalyType: "volume_oi" | "iv_spike" | "skew_shift" | "volume_surge";
  metric: number;
  baseline: number;
  contracts?: Array<{
    symbol: string;
    type: "call" | "put";
    strike: number;
    expiry: string;
  }>;
  direction: "bullish" | "bearish" | "unclear";
}

export interface ScanHitPayload {
  strategyId: string;
  evidence: Record<string, number>;
  barWindowHash: string;
  proposedAction: "buy" | "sell";
}

export interface NewsPayload {
  headline: string;
  url: string;
  publishedAt: string;
  sourceQuality: "wire" | "major" | "aggregator" | "social";
  tickersMentioned: string[];
}

export interface CalendarPayload {
  eventType: "earnings" | "fomc" | "cpi" | "fda" | "expiry" | "other";
  scheduledAt: string;
  symbol?: string;
}

export interface ManualPayload {
  note: string | null;
}

export type MarketSignal =
  | (MarketSignalBase & { kind: "filing"; payload: FilingPayload })
  | (MarketSignalBase & {
      kind: "market_dislocation";
      payload: DislocationPayload;
    })
  | (MarketSignalBase & { kind: "flow_anomaly"; payload: FlowAnomalyPayload })
  | (MarketSignalBase & { kind: "scan_hit"; payload: ScanHitPayload })
  | (MarketSignalBase & { kind: "news"; payload: NewsPayload })
  | (MarketSignalBase & { kind: "calendar_event"; payload: CalendarPayload })
  | (MarketSignalBase & { kind: "manual"; payload: ManualPayload });

/** Default TTLs per kind (ISO-8601 durations). */
export const DEFAULT_SIGNAL_TTL: Record<MarketSignalKind, string> = {
  filing: "PT6H",
  market_dislocation: "PT1H",
  flow_anomaly: "PT2H",
  scan_hit: "PT1H",
  news: "PT4H",
  calendar_event: "PT24H",
  manual: "PT4H",
};

/**
 * Parse a simple ISO-8601 duration used by signal TTLs.
 * Supports PnDTnHnMnS / PTnH / PTnM forms we emit (no weeks/years).
 */
export function parseTtlMs(ttl: string): number {
  const match = ttl.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i,
  );
  if (!match) {
    // Fallback: treat bare "4h" / "15m" cadence-style strings
    const cadence = ttl.match(/^(\d+)(m|h|d)$/i);
    if (cadence) {
      const n = Number(cadence[1]);
      const u = cadence[2].toLowerCase();
      if (u === "m") return n * 60_000;
      if (u === "h") return n * 3_600_000;
      return n * 86_400_000;
    }
    return 4 * 60 * 60 * 1000;
  }
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  return ((days * 24 + hours) * 60 + minutes) * 60_000 + seconds * 1000;
}

export function signalExpiresAt(detectedAt: string, ttl: string): string {
  return new Date(Date.parse(detectedAt) + parseTtlMs(ttl)).toISOString();
}

export function isSignalExpired(
  detectedAt: string,
  ttl: string,
  nowMs: number = Date.now(),
): boolean {
  return Date.parse(detectedAt) + parseTtlMs(ttl) < nowMs;
}

export function computeDedupeKey(
  kind: MarketSignalKind,
  parts: Record<string, string | number | null | undefined>,
): string {
  const ordered = Object.keys(parts)
    .sort()
    .map((k) => `${k}=${parts[k] ?? ""}`)
    .join("|");
  return `${kind}:${ordered}`;
}
