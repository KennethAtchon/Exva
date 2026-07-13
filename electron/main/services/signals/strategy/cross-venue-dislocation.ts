/**
 * Cross-venue dislocation detector: mid-vs-mid divergence between approved
 * Polymarket↔Kalshi matches, net of both venues' fees.
 *
 * v1 trades the cheap side on ONE venue (no simultaneous two-legged arb) —
 * settlement asymmetry and position limits make true arb a different machine.
 */

import {
  computeDedupeKey,
  DEFAULT_SIGNAL_TTL,
  type MarketSignal,
} from "@electron/shared/domain/market-signal";
import { KALSHI_FEE_BPS } from "../sources/kalshi-market-source";
import type { CrossVenueMarketLink } from "../../../db/repositories/signals/cross-venue-market-links-repo";

/** Polymarket effective fee ~0 when using maker; use conservative 100 bps. */
export const POLYMARKET_FEE_BPS = 100;

export interface VenueQuote {
  marketId: string;
  mid: number;
  spreadBps: number;
  liquidityUsd: number;
  question: string;
  resolutionAt: string;
  resolutionCriteria: string;
}

export interface CrossVenueScanInput {
  links: CrossVenueMarketLink[];
  polymarketQuotes: Map<string, VenueQuote>;
  kalshiQuotes: Map<string, VenueQuote>;
  /** Absolute mid divergence net of fees required to emit (e.g. 0.05 = 5¢). */
  minNetDivergence?: number;
  sourceId?: string;
  now?: string;
}

export interface CrossVenueScanResult {
  signals: MarketSignal[];
  evaluated: number;
  skippedUnapproved: number;
  skippedMissingQuote: number;
}

export function computeNetDivergence(
  polyMid: number,
  kalshiMid: number,
  polyFeeBps: number = POLYMARKET_FEE_BPS,
  kalshiFeeBps: number = KALSHI_FEE_BPS,
): number {
  const raw = Math.abs(polyMid - kalshiMid);
  const feeDrag = (polyFeeBps + kalshiFeeBps) / 10_000;
  return Math.max(0, raw - feeDrag);
}

export function runCrossVenueDislocationScan(
  input: CrossVenueScanInput,
): CrossVenueScanResult {
  const minDiv = input.minNetDivergence ?? 0.05;
  const now = input.now ?? new Date().toISOString();
  const sourceId = input.sourceId ?? "schedule:cross-venue-dislocation";
  const signals: MarketSignal[] = [];
  let skippedUnapproved = 0;
  let skippedMissingQuote = 0;
  let evaluated = 0;

  for (const link of input.links) {
    if (!link.approved) {
      skippedUnapproved += 1;
      continue;
    }
    evaluated += 1;
    const poly = input.polymarketQuotes.get(link.polymarketId);
    const kalshi = input.kalshiQuotes.get(link.kalshiTicker);
    if (!poly || !kalshi) {
      skippedMissingQuote += 1;
      continue;
    }

    const netDivergence = computeNetDivergence(poly.mid, kalshi.mid);
    if (netDivergence < minDiv) continue;

    // Trade the cheap side: buy Yes where mid is lower (after fees already netted).
    const cheapVenue: "polymarket" | "kalshi" =
      poly.mid <= kalshi.mid ? "polymarket" : "kalshi";
    const cheap = cheapVenue === "polymarket" ? poly : kalshi;
    const rich = cheapVenue === "polymarket" ? kalshi : poly;
    const counterpartVenue: "polymarket" | "kalshi" =
      cheapVenue === "polymarket" ? "kalshi" : "polymarket";

    const dedupeKey = computeDedupeKey("market_dislocation", {
      crossVenue: "1",
      polymarketId: link.polymarketId,
      kalshiTicker: link.kalshiTicker,
      day: now.slice(0, 10),
    });

    signals.push({
      id: crypto.randomUUID(),
      sourceId,
      kind: "market_dislocation",
      instrumentClass: "prediction_market",
      symbols: [
        cheapVenue === "polymarket"
          ? `pm:${link.polymarketId}`
          : `kalshi:${link.kalshiTicker}`,
      ],
      occurredAt: now,
      detectedAt: now,
      ttl: DEFAULT_SIGNAL_TTL.market_dislocation,
      dedupeKey,
      provenance: {
        url:
          cheapVenue === "polymarket"
            ? `https://polymarket.com/event/${link.polymarketId}`
            : `https://kalshi.com/markets/${link.kalshiTicker}`,
        raw: { linkId: link.id, cheapVenue },
      },
      payload: {
        marketId: cheap.marketId,
        question: cheap.question,
        outcome: "Yes",
        marketMid: cheap.mid,
        spreadBps: cheap.spreadBps,
        liquidityUsd: cheap.liquidityUsd,
        resolutionAt: cheap.resolutionAt,
        resolutionCriteria: cheap.resolutionCriteria,
        venue: cheapVenue,
        feeBps: cheapVenue === "kalshi" ? KALSHI_FEE_BPS : POLYMARKET_FEE_BPS,
        crossVenue: true,
        counterpartVenue,
        counterpartMarketId: rich.marketId,
        counterpartMid: rich.mid,
        netDivergence,
      },
    });
  }

  return { signals, evaluated, skippedUnapproved, skippedMissingQuote };
}
