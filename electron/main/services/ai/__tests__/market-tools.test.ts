import { describe, expect, it, vi } from "vitest";
import { createMarketTools } from "../tools/market-tools";

type StockToolExecutor = { execute: (input: { symbol: string; instrumentClass: "stock" }) => Promise<unknown> };
type OhlcvToolExecutor = {
  execute: (input: { symbol: string; instrumentClass: "stock" }) => Promise<{ bars?: unknown[] }>;
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
});
