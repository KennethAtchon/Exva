import { describe, expect, it, vi } from "vitest";
import { createMarketTools } from "../../tools/market-tools";
import { MockBrokerAdapter } from "../../broker/adapters/mock-adapter";

type StockToolExecutor = {
  execute: (input: {
    symbol: string;
    instrumentClass: "stock";
  }) => Promise<unknown>;
};
type CryptoQuoteToolExecutor = {
  execute: (input: {
    symbol: string;
    instrumentClass: "crypto";
  }) => Promise<unknown>;
};
type OhlcvToolExecutor = {
  execute: (input: {
    symbol: string;
    instrumentClass: "stock";
    timeframe?: string;
  }) => Promise<{ bars?: unknown[]; timeframe?: string; error?: string }>;
};

describe("market-tools", () => {
  it("returns routing error when no broker account exists", async () => {
    const tools = createMarketTools({
      sessionId: "s1",
      brokerRegistry: { get: vi.fn() } as never,
      brokerAccountIdByClass: () => null,
      include: { quote: true, ohlcv: false },
    });

    const getQuote = tools.get_quote as unknown as StockToolExecutor;
    const out = await getQuote.execute({
      symbol: "AAPL",
      instrumentClass: "stock",
    });

    expect(out).toEqual({
      error: "No broker account routing available for this instrument class.",
    });
  });

  it("get_ohlcv returns error when broker does not implement getOhlcv", async () => {
    const brokerRegistry = {
      get: vi.fn().mockResolvedValue({
        brokerType: "some_broker",
        getMarketSnapshot: vi.fn().mockResolvedValue({ price: 101.25 }),
        // no getOhlcv method
      }),
    };
    const tools = createMarketTools({
      sessionId: "s1",
      brokerRegistry: brokerRegistry as never,
      brokerAccountIdByClass: () => "b1",
      include: { quote: false, ohlcv: true },
    });

    const getOhlcv = tools.get_ohlcv as unknown as OhlcvToolExecutor;
    const out = await getOhlcv.execute({
      symbol: "AAPL",
      instrumentClass: "stock",
    });

    expect(out.error).toMatch(/does not support OHLCV/);
    expect(out.bars).toBeUndefined();
  });

  it("get_ohlcv delegates to adapter.getOhlcv when available", async () => {
    const mockBars = [
      {
        ts: "2026-05-01T00:00:00Z",
        open: 100,
        high: 105,
        low: 99,
        close: 103,
        volume: 5000,
      },
      {
        ts: "2026-05-02T00:00:00Z",
        open: 103,
        high: 108,
        low: 102,
        close: 107,
        volume: 6000,
      },
    ];
    const getOhlcvMock = vi.fn().mockResolvedValue(mockBars);
    const brokerRegistry = {
      get: vi.fn().mockResolvedValue({
        brokerType: "alpaca",
        getOhlcv: getOhlcvMock,
      }),
    };
    const tools = createMarketTools({
      sessionId: "s1",
      brokerRegistry: brokerRegistry as never,
      brokerAccountIdByClass: () => "b1",
      include: { quote: false, ohlcv: true },
    });

    const getOhlcv = tools.get_ohlcv as unknown as OhlcvToolExecutor;
    const out = await getOhlcv.execute({
      symbol: "AAPL",
      instrumentClass: "stock",
      timeframe: "1d",
    });

    expect(getOhlcvMock).toHaveBeenCalledWith("AAPL", "1d", 200);
    expect(out.bars).toEqual(mockBars);
    expect(out.error).toBeUndefined();
  });

  it("get_ohlcv with timeframe 4h passes timeframe through mock callback", async () => {
    const adapter = new MockBrokerAdapter();
    const capturedCalls: Array<{ symbol: string; timeframe?: string }> = [];
    const tools = createMarketTools({
      sessionId: "s1",
      brokerRegistry: { get: vi.fn() } as never,
      brokerAccountIdByClass: () => null,
      include: { quote: false, ohlcv: true },
      getMockOhlcv: (symbol, timeframe) => {
        capturedCalls.push({ symbol, timeframe });
        return adapter.getMockOhlcv(symbol, timeframe);
      },
    });

    const getOhlcv = tools.get_ohlcv as unknown as OhlcvToolExecutor;
    const out = await getOhlcv.execute({
      symbol: "AAPL",
      instrumentClass: "stock",
      timeframe: "4h",
    });

    expect(capturedCalls).toHaveLength(1);
    expect(capturedCalls[0]?.timeframe).toBe("4h");
    expect(out.timeframe).toBe("4h");
    expect(Array.isArray(out.bars)).toBe(true);
  });

  it("normalizes BITCOIN to BTC-USD for Coinbase crypto quotes", async () => {
    const getMarketSnapshot = vi.fn().mockResolvedValue({
      instrumentSymbol: "BTC-USD",
      price: 65000,
      timestamp: "2026-05-20T00:00:00.000Z",
    });
    const brokerRegistry = {
      get: vi.fn().mockResolvedValue({
        brokerType: "coinbase_advanced_trade",
        getMarketSnapshot,
      }),
    };
    const tools = createMarketTools({
      sessionId: "s1",
      brokerRegistry: brokerRegistry as never,
      brokerAccountIdByClass: () => "coinbase-1",
      include: { quote: true, ohlcv: false },
    });

    const getQuote = tools.get_quote as unknown as CryptoQuoteToolExecutor;
    const out = await getQuote.execute({
      symbol: "BITCOIN",
      instrumentClass: "crypto",
    });

    expect(getMarketSnapshot).toHaveBeenCalledWith("BTC-USD", {
      predictionOutcome: null,
    });
    expect(out).toMatchObject({
      symbol: "BITCOIN",
      canonicalSymbol: "BTC",
      brokerSymbol: "BTC-USD",
      instrumentClass: "crypto",
      price: 65000,
    });
  });
});
