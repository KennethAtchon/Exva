import { describe, expect, it, vi } from "vitest";
import { createMarketTools, scenarioMockNews } from "../tools/market-tools";
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
  }) => Promise<{ bars?: unknown[]; timeframe?: string }>;
};
type NewsToolExecutor = {
  execute: (input: { symbol: string }) => Promise<{ results?: unknown[] }>;
};

describe("market-tools", () => {
  it("returns routing error when no broker account exists", async () => {
    const tools = createMarketTools({
      sessionId: "s1",
      brokerRegistry: { get: vi.fn() } as never,
      brokerAccountIdByClass: () => null,
      include: { quote: true, ohlcv: false, news: false },
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

  it("returns synthetic bars for get_ohlcv", async () => {
    const brokerRegistry = {
      get: vi.fn().mockResolvedValue({
        getMarketSnapshot: vi.fn().mockResolvedValue({ price: 101.25 }),
      }),
    };
    const tools = createMarketTools({
      sessionId: "s1",
      brokerRegistry: brokerRegistry as never,
      brokerAccountIdByClass: () => "b1",
      include: { quote: false, ohlcv: true, news: false },
    });

    const getOhlcv = tools.get_ohlcv as unknown as OhlcvToolExecutor;
    const out = await getOhlcv.execute({
      symbol: "AAPL",
      instrumentClass: "stock",
    });

    expect(Array.isArray(out.bars)).toBe(true);
    expect(out.bars?.length).toBe(30);
  });

  it("returns mock news when provided", async () => {
    const tools = createMarketTools({
      sessionId: "s1",
      brokerRegistry: { get: vi.fn() } as never,
      brokerAccountIdByClass: () => "b1",
      include: { quote: false, ohlcv: false, news: true },
      mockNewsData: [
        {
          title: "{symbol} catalyst",
          snippet: "Catalyst snippet for {symbol}",
          url: "https://mock.local/1",
          publishedAt: "2026-05-08T00:00:00.000Z",
        },
      ],
    });

    const getNews = tools.get_news as unknown as NewsToolExecutor;
    const out = await getNews.execute({ symbol: "AAPL" });

    expect(out.results).toHaveLength(1);
    expect(out.results?.[0]).toMatchObject({
      title: "AAPL catalyst",
      snippet: "Catalyst snippet for AAPL",
      query: "AAPL",
    });
  });

  it("returns bullish scenario news with momentum wording", () => {
    const news = scenarioMockNews("bullish");
    const combined = news
      .map((item) => `${item.title} ${item.snippet}`)
      .join(" ")
      .toLowerCase();

    expect(news).toHaveLength(3);
    expect(combined).toMatch(/breakout|momentum|bullish|strength/);
  });

  it("returns three news items for every scenario", () => {
    for (const bias of [
      "bullish",
      "bearish",
      "sideways",
      "volatile",
    ] as const) {
      expect(scenarioMockNews(bias)).toHaveLength(3);
    }
  });

  it("buildSyntheticBars drifts upward toward spot price", async () => {
    const brokerRegistry = {
      get: vi.fn().mockResolvedValue({
        getMarketSnapshot: vi.fn().mockResolvedValue({ price: 200 }),
      }),
    };
    const tools = createMarketTools({
      sessionId: "s1",
      brokerRegistry: brokerRegistry as never,
      brokerAccountIdByClass: () => "b1",
      include: { quote: false, ohlcv: true, news: false },
    });

    const getOhlcv = tools.get_ohlcv as unknown as OhlcvToolExecutor;
    const out = await getOhlcv.execute({
      symbol: "AAPL",
      instrumentClass: "stock",
    });

    const bars = out.bars as Array<{ close: number }>;
    const first = bars.at(0);
    const last = bars.at(-1);
    if (!first || !last) throw new Error("expected non-empty bars");
    expect(first.close).toBeLessThan(last.close);
  });

  it("get_ohlcv with timeframe 4h passes timeframe through mock callback", async () => {
    const adapter = new MockBrokerAdapter();
    const capturedCalls: Array<{ symbol: string; timeframe?: string }> = [];
    const tools = createMarketTools({
      sessionId: "s1",
      brokerRegistry: { get: vi.fn() } as never,
      brokerAccountIdByClass: () => null,
      include: { quote: false, ohlcv: true, news: false },
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
      include: { quote: true, ohlcv: false, news: false },
    });

    const getQuote = tools.get_quote as unknown as CryptoQuoteToolExecutor;
    const out = await getQuote.execute({
      symbol: "BITCOIN",
      instrumentClass: "crypto",
    });

    expect(getMarketSnapshot).toHaveBeenCalledWith("BTC-USD");
    expect(out).toMatchObject({
      symbol: "BITCOIN",
      canonicalSymbol: "BTC",
      brokerSymbol: "BTC-USD",
      instrumentClass: "crypto",
      price: 65000,
    });
  });
});
