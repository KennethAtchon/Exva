import { z } from "zod";
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

/** Form 4 transaction specifics nested under FilingPayload. */
export interface Form4FilingDetails {
  transactionCode: string;
  role: string;
  shares: number;
  pricePerShare: number | null;
  totalValueUsd: number | null;
  isOpenMarketBuy: boolean;
  /** Populated when emitted by the insider-cluster scan. */
  clusterSize?: number;
  clusterValueUsd?: number;
  insiderCount?: number;
}

export interface FilingPayload {
  filingType: string;
  accessionNumber: string;
  itemCodes: string[];
  companyName: string | null;
  documentUrl: string;
  filedAt: string;
  polarityHint?: "positive" | "negative" | "unclear";
  /** Present for Form 4 filings / insider-cluster signals. */
  form4?: Form4FilingDetails;
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
  venue?: "polymarket" | "kalshi";
  /** Venue fee in basis points baked into cost fields. */
  feeBps?: number;
  /** True when emitted by the cross-venue dislocation detector. */
  crossVenue?: boolean;
  counterpartVenue?: "polymarket" | "kalshi";
  counterpartMarketId?: string;
  counterpartMid?: number;
  /** Mid-vs-mid divergence net of both venues' fees (absolute). */
  netDivergence?: number;
  /** Funding-rate / basis context (crypto dislocations). */
  fundingRate?: number;
  fundingPercentile?: number;
  basisBps?: number;
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
  /** When set, defined-risk vertical (options-flow v2). */
  spread?: {
    structure: "vertical";
    longLeg: string;
    shortLeg: string;
    width: number;
    netDebit: number;
    maxLoss: number;
  };
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
  /** Polarity for freshness cross-check against coincident filings/scans. */
  polarityHint?: "positive" | "negative" | "unclear";
}

export interface CalendarPayload {
  eventType: "earnings" | "fomc" | "cpi" | "fda" | "expiry" | "other";
  scheduledAt: string;
  symbol?: string;
  title?: string;
  source?: string;
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

// ---------------------------------------------------------------------------
// Zod payload schemas (round-trip / Dev Panel injection)
// ---------------------------------------------------------------------------

export const form4FilingDetailsSchema = z
  .object({
    transactionCode: z.string(),
    role: z.string(),
    shares: z.number(),
    pricePerShare: z.number().nullable(),
    totalValueUsd: z.number().nullable(),
    isOpenMarketBuy: z.boolean(),
    clusterSize: z.number().optional(),
    clusterValueUsd: z.number().optional(),
    insiderCount: z.number().optional(),
  })
  .strict();

export const filingPayloadSchema = z
  .object({
    filingType: z.string(),
    accessionNumber: z.string(),
    itemCodes: z.array(z.string()),
    companyName: z.string().nullable(),
    documentUrl: z.string(),
    filedAt: z.string(),
    polarityHint: z.enum(["positive", "negative", "unclear"]).optional(),
    form4: form4FilingDetailsSchema.optional(),
  })
  .strict();

export const dislocationPayloadSchema = z
  .object({
    marketId: z.string(),
    question: z.string(),
    outcome: z.string(),
    marketMid: z.number(),
    spreadBps: z.number(),
    liquidityUsd: z.number(),
    resolutionAt: z.string(),
    resolutionCriteria: z.string(),
    venue: z.enum(["polymarket", "kalshi"]).optional(),
    feeBps: z.number().optional(),
    crossVenue: z.boolean().optional(),
    counterpartVenue: z.enum(["polymarket", "kalshi"]).optional(),
    counterpartMarketId: z.string().optional(),
    counterpartMid: z.number().optional(),
    netDivergence: z.number().optional(),
    fundingRate: z.number().optional(),
    fundingPercentile: z.number().optional(),
    basisBps: z.number().optional(),
  })
  .strict();

export const flowAnomalyPayloadSchema = z
  .object({
    underlying: z.string(),
    anomalyType: z.enum([
      "volume_oi",
      "iv_spike",
      "skew_shift",
      "volume_surge",
    ]),
    metric: z.number(),
    baseline: z.number(),
    contracts: z
      .array(
        z.object({
          symbol: z.string(),
          type: z.enum(["call", "put"]),
          strike: z.number(),
          expiry: z.string(),
        }),
      )
      .optional(),
    direction: z.enum(["bullish", "bearish", "unclear"]),
    spread: z
      .object({
        structure: z.literal("vertical"),
        longLeg: z.string(),
        shortLeg: z.string(),
        width: z.number(),
        netDebit: z.number(),
        maxLoss: z.number(),
      })
      .optional(),
  })
  .strict();

export const scanHitPayloadSchema = z
  .object({
    strategyId: z.string(),
    evidence: z.record(z.number()),
    barWindowHash: z.string(),
    proposedAction: z.enum(["buy", "sell"]),
  })
  .strict();

export const newsPayloadSchema = z
  .object({
    headline: z.string(),
    url: z.string(),
    publishedAt: z.string(),
    sourceQuality: z.enum(["wire", "major", "aggregator", "social"]),
    tickersMentioned: z.array(z.string()),
    polarityHint: z.enum(["positive", "negative", "unclear"]).optional(),
  })
  .strict();

export const calendarPayloadSchema = z
  .object({
    eventType: z.enum(["earnings", "fomc", "cpi", "fda", "expiry", "other"]),
    scheduledAt: z.string(),
    symbol: z.string().optional(),
    title: z.string().optional(),
    source: z.string().optional(),
  })
  .strict();

export const manualPayloadSchema = z
  .object({
    note: z.string().nullable(),
  })
  .strict();

export const marketSignalKindSchema = z.enum([
  "filing",
  "market_dislocation",
  "flow_anomaly",
  "scan_hit",
  "news",
  "calendar_event",
  "manual",
]);

export function payloadSchemaForKind(kind: MarketSignalKind) {
  switch (kind) {
    case "filing":
      return filingPayloadSchema;
    case "market_dislocation":
      return dislocationPayloadSchema;
    case "flow_anomaly":
      return flowAnomalyPayloadSchema;
    case "scan_hit":
      return scanHitPayloadSchema;
    case "news":
      return newsPayloadSchema;
    case "calendar_event":
      return calendarPayloadSchema;
    case "manual":
      return manualPayloadSchema;
  }
}

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
