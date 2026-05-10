import { describe, expect, it, vi } from "vitest";
import { createMarketTools, scenarioMockNews } from "../tools/market-tools";

type StockToolExecutor = { execute: (input: { symbol: string; instrumentClass: "stock" }) => Promise<unknown> };
type OhlcvToolExecutor = {
  execute: (input: { symbol: string; instrumentClass: "stock" }) => Promise<{ bars?: unknown[] }>;
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
    const out = await getQuote.execute({ symbol: "AAPL", instrumentClass: "stock" });

    expect(out).toEqual({ error: "No broker account routing available for this instrument class." });
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
    const out = await getOhlcv.execute({ symbol: "AAPL", instrumentClass: "stock" });

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
        { title: "{symbol} catalyst", snippet: "Catalyst snippet for {symbol}", url: "https://mock.local/1", publishedAt: "2026-05-08T00:00:00.000Z" },
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
    const combined = news.map((item) => `${item.title} ${item.snippet}`).join(" ").toLowerCase();

    expect(news).toHaveLength(3);
    expect(combined).toMatch(/breakout|momentum|bullish|strength/);
  });

  it("returns three news items for every scenario", () => {
    for (const bias of ["bullish", "bearish", "sideways", "volatile"] as const) {
      expect(scenarioMockNews(bias)).toHaveLength(3);
    }
  });
});
