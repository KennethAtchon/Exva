import { describe, expect, it, vi } from "vitest";
import {
  MOCK_SCENARIO_KINDS,
  type MockScenarioKind,
} from "@electron/shared/domain/mock-scenario";
import { MockMarketSimulator } from "../mock-market-simulator";

describe("MockMarketSimulator", () => {
  it("creates scenario-specific adapters with configured bias", () => {
    const bullish = MockMarketSimulator.createAdapter("clean_breakout");
    const bearish = MockMarketSimulator.createAdapter("gap_down_after_entry");

    expect(bullish.getScenarioKind()).toBe("clean_breakout");
    expect(bullish.getScenarioBias()).toBe("bullish");
    expect(bearish.getScenarioKind()).toBe("gap_down_after_entry");
    expect(bearish.getScenarioBias()).toBe("bearish");
  });

  it("simulates an uptrend price path for bullish scenarios", async () => {
    const adapter = MockMarketSimulator.createAdapter("clean_breakout");
    const bars = adapter.getMockOhlcv("NVDA", "1d", 20);

    expect(bars.at(0)?.close ?? 0).toBeLessThan(bars.at(-1)?.close ?? 0);
  });

  it("auto-closes open positions with positive PnL on clean_breakout", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T12:00:00.000Z"));
    try {
      const adapter = MockMarketSimulator.createAdapter("clean_breakout");
      const placed = await adapter.placeOrder({
        instrumentSymbol: "NVDA",
        instrumentType: "stock",
        side: "BUY",
        sizeUsd: 1000,
        clientOrderId: "sim-1",
      });

      vi.advanceTimersByTime(31_000);
      const status = await adapter.getOrderStatus(placed.brokerOrderId);

      expect(status.status).toBe("closed");
      expect(status.realizedPnlUsd).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("exposes discovery fixtures for every scenario kind", () => {
    const urlOptionalKinds = new Set<MockScenarioKind>([
      "stale_quote",
      "wide_spread",
    ]);

    for (const kind of MOCK_SCENARIO_KINDS) {
      const fixtures = MockMarketSimulator.fixturesFor(kind);
      expect(fixtures.primarySymbols.length).toBeGreaterThan(0);
      expect(fixtures.webSearch.length).toBeGreaterThan(0);
      if (!urlOptionalKinds.has(kind)) {
        expect(Object.keys(fixtures.urlContent).length).toBeGreaterThan(0);
      }
      expect(fixtures.news.length).toBeGreaterThan(0);
      expect(fixtures.redditPosts.length).toBeGreaterThan(0);
      expect(fixtures.trendingSymbols.length).toBeGreaterThan(0);
    }
  });
});
