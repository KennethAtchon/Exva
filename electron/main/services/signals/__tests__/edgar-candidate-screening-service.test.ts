import { describe, expect, it } from "vitest";
import { EdgarCandidateScreeningService } from "../edgar-candidate-screening-service";

describe("EdgarCandidateScreeningService", () => {
  const identity = {
    cik: "320193",
    accession: "0000320193-26-000001",
    filingUrl: "https://www.sec.gov/Archives/edgar/data/320193/x.htm",
    acceptedAt: new Date().toISOString(),
    form: "8-K",
    items: ["2.02"],
    ticker: "AAPL",
    companyName: "Apple",
  };

  const market = {
    priceUsd: 190,
    avgDollarVolume20d: 2_000_000_000,
    spreadBps: 5,
    listedExchange: "NASDAQ",
    isOtc: false,
    assetActive: true,
  };

  it("passes a liquid listed equity with material item", () => {
    const svc = new EdgarCandidateScreeningService();
    const result = svc.screen({ identity, market });
    expect(result.ok).toBe(true);
    expect(svc.getCounts().passed).toBe(1);
  });

  it("rejects OTC before AI", () => {
    const svc = new EdgarCandidateScreeningService();
    const result = svc.screen({
      identity,
      market: { ...market, isOtc: true, listedExchange: null },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.gate).toBe("listed_exchange");
  });

  it("rejects stale filings", () => {
    const svc = new EdgarCandidateScreeningService({
      now: () => new Date("2026-07-27T20:00:00.000Z"),
    });
    const result = svc.screen({
      identity: {
        ...identity,
        acceptedAt: "2026-07-27T10:00:00.000Z", // 10h old
      },
      market,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.gate).toBe("filing_freshness");
  });

  it("rejects sub-$5 names", () => {
    const svc = new EdgarCandidateScreeningService();
    const result = svc.screen({
      identity,
      market: { ...market, priceUsd: 3, avgDollarVolume20d: 1_000_000 },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.gate).toBe("price_floor");
  });
});
