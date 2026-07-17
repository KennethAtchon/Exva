import { describe, expect, it } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import { CrossVenueMarketLinksRepo } from "../../../db/repositories/signals/cross-venue-market-links-repo";
import { Form4TransactionsRepo } from "../../../db/repositories/signals/form4-transactions-repo";
import { FundingRatesRepo } from "../../../db/repositories/marketdata/funding-rates-repo";
import { AlphaSourceScanService } from "../alpha-source-scan-service";
import type { MarketSignal } from "@electron/shared/domain/market-signal";
import type { VenueQuote } from "../strategy/cross-venue-dislocation";

describe("AlphaSourceScanService", () => {
  it("runs funding, form4, and cross-venue scanners and emits signals", async () => {
    const db = createTestDb();
    const fundingRates = new FundingRatesRepo(db);
    const form4Transactions = new Form4TransactionsRepo(db);
    const crossVenueLinks = new CrossVenueMarketLinksRepo(db);
    const emitted: Array<{ groupKey: string; signals: MarketSignal[] }> = [];

    const baseTs = Date.parse("2026-07-01T00:00:00.000Z");
    for (let i = 0; i < 30; i++) {
      fundingRates.upsert({
        venue: "kraken",
        symbol: "BTC/USD",
        ts: new Date(baseTs + i * 3_600_000).toISOString(),
        rate: 0.0001 + i * 0.00001,
      });
    }

    form4Transactions.upsert({
      accessionNumber: "a1",
      cik: "1",
      ticker: "ACME",
      companyName: "Acme",
      insiderName: "Alice",
      role: "CEO",
      transactionCode: "P",
      shares: 10_000,
      pricePerShare: 20,
      totalValueUsd: 200_000,
      isOpenMarketBuy: true,
      filedAt: "2026-07-10T12:00:00.000Z",
      transactionDate: "2026-07-09",
      documentUrl: null,
    });
    form4Transactions.upsert({
      accessionNumber: "a2",
      cik: "1",
      ticker: "ACME",
      companyName: "Acme",
      insiderName: "Bob",
      role: "CFO",
      transactionCode: "P",
      shares: 8_000,
      pricePerShare: 21,
      totalValueUsd: 168_000,
      isOpenMarketBuy: true,
      filedAt: "2026-07-11T12:00:00.000Z",
      transactionDate: "2026-07-10",
      documentUrl: null,
    });

    crossVenueLinks.upsert({
      polymarketId: "pm-1",
      kalshiTicker: "KX-1",
      confidence: 0.9,
      approved: true,
      questionPolymarket: "Will X happen?",
      questionKalshi: "Will X happen?",
      resolutionDate: "2026-12-01",
    });

    const quote = (marketId: string, mid: number): VenueQuote => ({
      marketId,
      mid,
      spreadBps: 50,
      liquidityUsd: 10_000,
      question: "Will X happen?",
      resolutionAt: "2026-12-01T00:00:00.000Z",
      resolutionCriteria: "Official",
    });

    const service = new AlphaSourceScanService({
      fundingRates,
      form4Transactions,
      crossVenueLinks,
      intervalMs: 60_000,
      emitSignals: async (signals, groupKey) => {
        emitted.push({ groupKey, signals });
      },
      fetchFundingRates: async () => [
        {
          venue: "kraken",
          symbol: "BTC/USD",
          ts: new Date(baseTs + 30 * 3_600_000).toISOString(),
          rate: 0.01,
        },
      ],
      fetchVenueQuotes: async () => ({
        polymarketQuotes: new Map([["pm-1", quote("pm-1", 0.4)]]),
        kalshiQuotes: new Map([["KX-1", quote("KX-1", 0.7)]]),
      }),
    });

    const result = await service.tickNow();
    expect(result.form4Signals).toBeGreaterThan(0);
    expect(result.crossVenueSignals).toBeGreaterThan(0);
    expect(result.fundingSignals).toBeGreaterThan(0);
    expect(emitted.map((e) => e.groupKey).sort()).toEqual([
      "alpha:cross-venue-dislocation",
      "alpha:form4-insider-cluster",
      "alpha:funding-basis",
    ]);
    db.sqlite.close();
  });

  it("skips cross-venue when quote fetcher missing", async () => {
    const db = createTestDb();
    const service = new AlphaSourceScanService({
      fundingRates: new FundingRatesRepo(db),
      form4Transactions: new Form4TransactionsRepo(db),
      crossVenueLinks: new CrossVenueMarketLinksRepo(db),
      emitSignals: async () => undefined,
      fetchFundingRates: async () => [],
    });
    new CrossVenueMarketLinksRepo(db).upsert({
      polymarketId: "pm-1",
      kalshiTicker: "KX-1",
      confidence: 0.9,
      approved: true,
    });
    const result = await service.tickNow();
    expect(result.crossVenueSignals).toBe(0);
    db.sqlite.close();
  });
});
