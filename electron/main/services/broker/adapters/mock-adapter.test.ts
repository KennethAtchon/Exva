import { describe, expect, it } from "vitest";
import { DEFAULT_MOCK_SCENARIO, MockBrokerAdapter } from "./mock-adapter";

describe("MockBrokerAdapter", () => {
  it("defaults to a bullish scenario bias", () => {
    const adapter = new MockBrokerAdapter();

    expect(adapter.getScenarioBias()).toBe(DEFAULT_MOCK_SCENARIO.bias);
  });

  it("produces an uptrend over 30 bars by default", () => {
    const adapter = new MockBrokerAdapter();
    const bars = adapter.getMockOhlcv("NVDA", "1d", 30);

    expect(bars).toHaveLength(30);
    expect(bars.at(0)?.close ?? 0).toBeLessThan(bars.at(-1)?.close ?? 0);
  });

  it("returns 200 bars by default", () => {
    const adapter = new MockBrokerAdapter();
    const bars = adapter.getMockOhlcv("AAPL");

    expect(bars).toHaveLength(200);
  });

  it("returns sub-day bars for 4h timeframe", () => {
    const adapter = new MockBrokerAdapter();
    const bars = adapter.getMockOhlcv("AAPL", "4h", 10);

    expect(bars).toHaveLength(10);
    const lastBar = bars.at(-1);
    const firstBar = bars.at(0);
    if (!lastBar || !firstBar) throw new Error("expected bars");
    const spanMs =
      new Date(lastBar.ts).getTime() - new Date(firstBar.ts).getTime();
    expect(spanMs).toBeLessThan(24 * 60 * 60 * 1000 * 10);
    const barMs = 4 * 60 * 60 * 1000;
    expect(spanMs).toBeCloseTo(barMs * 9, -4);
  });

  it("getMarketSnapshot returns bid, ask, and spreadPct", async () => {
    const adapter = new MockBrokerAdapter();
    const snap = await adapter.getMarketSnapshot("AAPL");

    expect(snap.bid).toBeDefined();
    expect(snap.ask).toBeDefined();
    expect(snap.spreadPct).toBeDefined();
    expect(snap.ask ?? 0).toBeGreaterThan(snap.bid ?? 0);
    expect(snap.volume).toBeDefined();
  });

  it("wide_spread scenario returns spreadPct > 2", async () => {
    const adapter = new MockBrokerAdapter({ kind: "wide_spread" });
    const snap = await adapter.getMarketSnapshot("AAPL");

    expect(snap.spreadPct).toBeGreaterThan(2);
  });

  it("stale_quote scenario returns timestamp older than 10 minutes", async () => {
    const adapter = new MockBrokerAdapter({ kind: "stale_quote" });
    const snap = await adapter.getMarketSnapshot("AAPL");
    const ageMs = Date.now() - new Date(snap.timestamp).getTime();

    expect(ageMs).toBeGreaterThan(10 * 60 * 1000);
  });

  it("losing trade on gap_down_after_entry produces negative realizedPnlUsd", async () => {
    const adapter = new MockBrokerAdapter({ kind: "gap_down_after_entry" });
    const placed = await adapter.placeOrder({
      instrumentSymbol: "AAPL",
      instrumentType: "stock",
      side: "BUY",
      sizeUsd: 1000,
      clientOrderId: "test-1",
    });
    const closed = await adapter.closeOrder(placed.brokerOrderId);

    expect(closed.realizedPnlUsd).toBeLessThan(0);
  });

  it("losing trade on failed_breakout produces negative realizedPnlUsd", async () => {
    const adapter = new MockBrokerAdapter({ kind: "failed_breakout" });
    const placed = await adapter.placeOrder({
      instrumentSymbol: "AAPL",
      instrumentType: "stock",
      side: "BUY",
      sizeUsd: 1000,
      clientOrderId: "test-2",
    });
    const closed = await adapter.closeOrder(placed.brokerOrderId);

    expect(closed.realizedPnlUsd).toBeLessThan(0);
  });

  it("winning trade on clean_breakout produces positive realizedPnlUsd", async () => {
    const adapter = new MockBrokerAdapter({ kind: "clean_breakout" });
    const placed = await adapter.placeOrder({
      instrumentSymbol: "AAPL",
      instrumentType: "stock",
      side: "BUY",
      sizeUsd: 1000,
      clientOrderId: "test-3",
    });
    const closed = await adapter.closeOrder(placed.brokerOrderId);

    expect(closed.realizedPnlUsd).toBeGreaterThan(0);
  });

  it("partial_fill returns filledSizeUsd less than requested sizeUsd", async () => {
    const adapter = new MockBrokerAdapter({ kind: "partial_fill" });
    const result = await adapter.placeOrder({
      instrumentSymbol: "AAPL",
      instrumentType: "stock",
      side: "BUY",
      sizeUsd: 1000,
      clientOrderId: "test-4",
    });

    expect(result.filledSizeUsd).toBeDefined();
    expect(result.filledSizeUsd ?? 0).toBeLessThan(1000);
    expect(result.filledSizeUsd ?? 0).toBeGreaterThan(0);
  });

  it("broker_reject throws on placeOrder", async () => {
    const adapter = new MockBrokerAdapter({ kind: "broker_reject" });

    await expect(
      adapter.placeOrder({
        instrumentSymbol: "AAPL",
        instrumentType: "stock",
        side: "BUY",
        sizeUsd: 1000,
        clientOrderId: "test-5",
      }),
    ).rejects.toThrow("RISK_LIMIT_EXCEEDED");
  });

  it("rate_limit throws with 429 message", async () => {
    const adapter = new MockBrokerAdapter({ kind: "rate_limit" });

    await expect(
      adapter.placeOrder({
        instrumentSymbol: "AAPL",
        instrumentType: "stock",
        side: "BUY",
        sizeUsd: 1000,
        clientOrderId: "test-6",
      }),
    ).rejects.toThrow("429");
  });

  it("marketClosed throws on getMarketSnapshot", async () => {
    const adapter = new MockBrokerAdapter({ marketClosed: true });

    await expect(adapter.getMarketSnapshot("AAPL")).rejects.toThrow(
      "Market is closed",
    );
  });

  it("marketClosed throws on placeOrder", async () => {
    const adapter = new MockBrokerAdapter({ marketClosed: true });

    await expect(
      adapter.placeOrder({
        instrumentSymbol: "AAPL",
        instrumentType: "stock",
        side: "BUY",
        sizeUsd: 1000,
        clientOrderId: "test-7",
      }),
    ).rejects.toThrow("closed");
  });

  it("getScenarioKind returns the configured kind", () => {
    const adapter = new MockBrokerAdapter({ kind: "news_reversal" });

    expect(adapter.getScenarioKind()).toBe("news_reversal");
  });

  it("clean_breakout bars close near the range high with rising late volume", () => {
    const adapter = new MockBrokerAdapter({ kind: "clean_breakout" });
    const bars = adapter.getMockOhlcv("NVDA", "4h", 30);
    const last = bars.at(-1);
    const rangeHigh = Math.max(...bars.map((bar) => bar.high));

    expect(last).toBeDefined();
    if (!last) {
      throw new Error("Expected a final OHLCV bar");
    }
    expect(last.close).toBeGreaterThanOrEqual(rangeHigh * 0.995);
    expect(last.volume ?? 0).toBeGreaterThan(bars.at(-5)?.volume ?? 0);
  });
});
