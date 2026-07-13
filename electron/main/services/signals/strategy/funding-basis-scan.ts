/**
 * Crypto funding / basis dislocation scan.
 * Extreme funding percentile vs trailing window → market_dislocation signal.
 */

import {
  computeDedupeKey,
  DEFAULT_SIGNAL_TTL,
  type MarketSignal,
} from "@electron/shared/domain/market-signal";
import { createLogger } from "../../infra/log";

const fundingLogger = createLogger("funding-basis-scan");

export interface FundingObservation {
  venue: string;
  symbol: string;
  ts: string;
  rate: number;
  /** Optional spot-future basis in bps. */
  basisBps?: number;
}

export interface FundingDislocationHit {
  venue: string;
  symbol: string;
  rate: number;
  percentile: number;
  basisBps: number | null;
  windowSize: number;
}

export interface FundingScanThresholds {
  /** Trailing window length (observations). */
  windowSize: number;
  /** Emit when |percentile| is this extreme (0–1), e.g. 0.95. */
  extremePercentile: number;
}

export const DEFAULT_FUNDING_THRESHOLDS: FundingScanThresholds = {
  windowSize: 90,
  extremePercentile: 0.95,
};

export function percentileRank(value: number, sample: number[]): number {
  if (sample.length === 0) return 0.5;
  const sorted = [...sample].sort((a, b) => a - b);
  let below = 0;
  for (const v of sorted) {
    if (v < value) below += 1;
    else break;
  }
  return below / sorted.length;
}

export function detectFundingDislocations(
  history: FundingObservation[],
  latest: FundingObservation,
  thresholds: FundingScanThresholds = DEFAULT_FUNDING_THRESHOLDS,
): FundingDislocationHit | null {
  const same = history.filter(
    (h) => h.venue === latest.venue && h.symbol === latest.symbol,
  );
  const window = same.slice(-thresholds.windowSize);
  if (window.length < Math.min(20, thresholds.windowSize)) return null;

  const rates = window.map((w) => w.rate);
  const pct = percentileRank(latest.rate, rates);
  const extreme =
    pct >= thresholds.extremePercentile ||
    pct <= 1 - thresholds.extremePercentile;
  if (!extreme) return null;

  return {
    venue: latest.venue,
    symbol: latest.symbol,
    rate: latest.rate,
    percentile: pct,
    basisBps: latest.basisBps ?? null,
    windowSize: window.length,
  };
}

export function fundingHitToMarketSignal(
  hit: FundingDislocationHit,
  opts?: { sourceId?: string; now?: string },
): MarketSignal {
  const now = opts?.now ?? new Date().toISOString();
  const sourceId = opts?.sourceId ?? "schedule:funding-basis";
  return {
    id: crypto.randomUUID(),
    sourceId,
    kind: "market_dislocation",
    instrumentClass: "crypto",
    symbols: [hit.symbol],
    occurredAt: now,
    detectedAt: now,
    ttl: DEFAULT_SIGNAL_TTL.market_dislocation,
    dedupeKey: computeDedupeKey("market_dislocation", {
      venue: hit.venue,
      symbol: hit.symbol,
      kind: "funding",
      day: now.slice(0, 10),
    }),
    provenance: { raw: hit },
    payload: {
      marketId: `${hit.venue}:${hit.symbol}`,
      question: `Funding rate extreme for ${hit.symbol} on ${hit.venue}`,
      outcome: hit.rate > 0 ? "long_crowded" : "short_crowded",
      marketMid: 0.5,
      spreadBps: 0,
      liquidityUsd: 0,
      resolutionAt: now,
      resolutionCriteria: "Funding mean-reversion pressure (context)",
      fundingRate: hit.rate,
      fundingPercentile: hit.percentile,
      basisBps: hit.basisBps ?? undefined,
    },
  };
}

/**
 * Fetch recent funding rates from Kraken futures public API (no auth).
 * Symbol example: PF_XBTUSD → mapped to BTC/USD.
 */
export async function fetchKrakenFundingRates(
  symbols: string[] = ["PF_XBTUSD", "PF_ETHUSD"],
): Promise<FundingObservation[]> {
  const out: FundingObservation[] = [];
  const now = new Date().toISOString();
  for (const symbol of symbols) {
    try {
      const url = `https://futures.kraken.com/derivatives/api/v3/tickers`;
      const response = await fetch(url);
      if (!response.ok) continue;
      const body = (await response.json()) as {
        tickers?: Array<{
          symbol?: string;
          fundingRate?: number;
          markPrice?: number;
          indexPrice?: number;
        }>;
      };
      const tickers = body.tickers ?? [];
      const row = tickers.find((t) => t.symbol === symbol);
      if (!row || typeof row.fundingRate !== "number") continue;
      const spot = Number(row.indexPrice ?? 0);
      const mark = Number(row.markPrice ?? 0);
      const basisBps =
        spot > 0 && mark > 0 ? ((mark - spot) / spot) * 10_000 : undefined;
      out.push({
        venue: "kraken",
        symbol: mapKrakenSymbol(symbol),
        ts: now,
        rate: row.fundingRate,
        basisBps,
      });
    } catch (err) {
      // Per-symbol isolation for public funding poll — keep scanning others.
      fundingLogger.warn(
        { err, symbol },
        "kraken funding fetch failed; skipping symbol",
      );
    }
  }
  return out;
}

function mapKrakenSymbol(sym: string): string {
  if (sym.includes("XBT") || sym.includes("BTC")) return "BTC/USD";
  if (sym.includes("ETH")) return "ETH/USD";
  return sym;
}
