import { describe, expect, it, vi } from "vitest";
import {
  createTrendingSymbolsTool,
  MOCK_TRENDING_SYMBOLS,
} from "../../tools/trending-symbols-tool";

type TrendingExecutor = {
  execute: () => Promise<{
    symbols: Array<{ symbol: string; sentiment: string | null }>;
  }>;
};

describe("social discovery tools", () => {
  const apiCallLogRepo = {
    insert: vi.fn(),
  };

  it("returns mock trending symbols when provided", async () => {
    const tool = createTrendingSymbolsTool({
      sessionId: "s1",
      apiCallLogRepo: apiCallLogRepo as never,
      mockSymbols: MOCK_TRENDING_SYMBOLS,
    }) as unknown as TrendingExecutor;

    const result = await tool.execute();

    expect(result.symbols).toHaveLength(MOCK_TRENDING_SYMBOLS.length);
    expect(result.symbols[0]).toMatchObject({
      symbol: "NVDA",
      sentiment: "Bullish",
    });
  });
});
