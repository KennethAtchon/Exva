import { describe, expect, it } from "vitest";
import {
  computeDedupeKey,
  dislocationPayloadSchema,
  filingPayloadSchema,
  newsPayloadSchema,
  calendarPayloadSchema,
  scanHitPayloadSchema,
  flowAnomalyPayloadSchema,
  payloadSchemaForKind,
} from "../market-signal";

describe("MarketSignal payload Zod round-trip", () => {
  it("round-trips filing + form4", () => {
    const payload = {
      filingType: "4",
      accessionNumber: "0001",
      itemCodes: ["FORM4_CLUSTER"],
      companyName: "Acme",
      documentUrl: "https://sec.gov",
      filedAt: "2026-07-01T00:00:00.000Z",
      polarityHint: "positive" as const,
      form4: {
        transactionCode: "P",
        role: "CEO",
        shares: 1000,
        pricePerShare: 10,
        totalValueUsd: 10_000,
        isOpenMarketBuy: true,
        insiderCount: 3,
        clusterValueUsd: 250_000,
      },
    };
    expect(filingPayloadSchema.parse(payload)).toEqual(payload);
    expect(payloadSchemaForKind("filing").parse(payload)).toEqual(payload);
  });

  it("round-trips market_dislocation with crossVenue", () => {
    const payload = {
      marketId: "m1",
      question: "Will X happen?",
      outcome: "Yes",
      marketMid: 0.4,
      spreadBps: 100,
      liquidityUsd: 50_000,
      resolutionAt: "2026-12-01T00:00:00.000Z",
      resolutionCriteria: "Official",
      venue: "kalshi" as const,
      feeBps: 175,
      crossVenue: true,
      counterpartVenue: "polymarket" as const,
      counterpartMarketId: "pm1",
      counterpartMid: 0.52,
      netDivergence: 0.08,
    };
    expect(dislocationPayloadSchema.parse(payload)).toEqual(payload);
  });

  it("round-trips news / calendar / scan_hit / flow_anomaly", () => {
    expect(
      newsPayloadSchema.parse({
        headline: "Acme beats",
        url: "https://example.com",
        publishedAt: "2026-07-01T00:00:00.000Z",
        sourceQuality: "wire",
        tickersMentioned: ["ACME"],
        polarityHint: "positive",
      }).headline,
    ).toBe("Acme beats");

    expect(
      calendarPayloadSchema.parse({
        eventType: "earnings",
        scheduledAt: "2026-07-15T20:00:00.000Z",
        symbol: "NVDA",
        title: "NVDA earnings",
      }).symbol,
    ).toBe("NVDA");

    expect(
      scanHitPayloadSchema.parse({
        strategyId: "unusual-volume",
        evidence: { rvol: 3.2, baselineVol: 1e6, priceBreakPct: 0.01 },
        barWindowHash: "abc",
        proposedAction: "buy",
      }).evidence.rvol,
    ).toBe(3.2);

    expect(
      flowAnomalyPayloadSchema.parse({
        underlying: "AAPL",
        anomalyType: "volume_oi",
        metric: 4,
        baseline: 1,
        direction: "bullish",
        spread: {
          structure: "vertical",
          longLeg: "AAPL250117C00150000",
          shortLeg: "AAPL250117C00155000",
          width: 5,
          netDebit: 1.2,
          maxLoss: 1.2,
        },
      }).spread?.maxLoss,
    ).toBe(1.2);
  });

  it("dedupeKey includes kind and stable parts", () => {
    expect(
      computeDedupeKey("market_dislocation", {
        venue: "kalshi",
        marketId: "XYZ",
      }),
    ).toBe("market_dislocation:marketId=XYZ|venue=kalshi");
  });
});
