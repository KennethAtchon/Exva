/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, expect, it } from "vitest";
import {
  computeNetDivergence,
  runCrossVenueDislocationScan,
  POLYMARKET_FEE_BPS,
} from "../cross-venue-dislocation";
import { KALSHI_FEE_BPS } from "../../sources/kalshi-market-source";
import type { CrossVenueMarketLink } from "../../../../db/repositories/signals/cross-venue-market-links-repo";

const link = (
  overrides?: Partial<CrossVenueMarketLink>,
): CrossVenueMarketLink => ({
  id: "link-1",
  polymarketId: "pm-1",
  kalshiTicker: "KXTEST-26",
  confidence: 0.9,
  approved: true,
  questionPolymarket: "Will Fed cut in July?",
  questionKalshi: "Fed cuts rates in July?",
  resolutionDate: "2026-07-31",
  matchMethod: "manual",
  notes: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("cross-venue dislocation", () => {
  it("nets fees out of raw mid divergence", () => {
    const raw = 0.1;
    const net = computeNetDivergence(0.4, 0.5);
    expect(net).toBeCloseTo(
      raw - (POLYMARKET_FEE_BPS + KALSHI_FEE_BPS) / 10_000,
      6,
    );
  });

  it("emits crossVenue signal for approved links above threshold", () => {
    const result = runCrossVenueDislocationScan({
      links: [link()],
      polymarketQuotes: new Map([
        [
          "pm-1",
          {
            marketId: "pm-1",
            mid: 0.4,
            spreadBps: 50,
            liquidityUsd: 20_000,
            question: "Will Fed cut in July?",
            resolutionAt: "2026-07-31T00:00:00.000Z",
            resolutionCriteria: "FOMC",
          },
        ],
      ]),
      kalshiQuotes: new Map([
        [
          "KXTEST-26",
          {
            marketId: "KXTEST-26",
            mid: 0.55,
            spreadBps: 80,
            liquidityUsd: 15_000,
            question: "Fed cuts rates in July?",
            resolutionAt: "2026-07-31T00:00:00.000Z",
            resolutionCriteria: "FOMC",
          },
        ],
      ]),
      minNetDivergence: 0.05,
      now: "2026-07-01T12:00:00.000Z",
    });
    expect(result.signals).toHaveLength(1);
    const signal = result.signals[0]!;
    expect(signal.kind).toBe("market_dislocation");
    if (signal.kind !== "market_dislocation") throw new Error("unreachable");
    expect(signal.payload.crossVenue).toBe(true);
    expect(signal.payload.venue).toBe("polymarket"); // cheap side
    expect(signal.dedupeKey).toContain("crossVenue=1");
  });

  it("skips unapproved links", () => {
    const result = runCrossVenueDislocationScan({
      links: [link({ approved: false })],
      polymarketQuotes: new Map(),
      kalshiQuotes: new Map(),
    });
    expect(result.skippedUnapproved).toBe(1);
    expect(result.signals).toHaveLength(0);
  });
});
