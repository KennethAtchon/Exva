import { describe, expect, it, vi } from "vitest";
import { createSearchRedditTool, MOCK_REDDIT_POSTS } from "../tools/search-reddit-tool";
import { createTrendingSymbolsTool, MOCK_TRENDING_SYMBOLS } from "../tools/trending-symbols-tool";

type RedditExecutor = {
  execute: (input: {
    query: string;
    sort: "relevance" | "hot" | "top" | "new";
    timeFilter: "hour" | "day" | "week";
    subreddits?: string[];
  }) => Promise<{ subreddits?: string[]; posts: Array<{ body: string }> }>;
};

type TrendingExecutor = {
  execute: () => Promise<{ symbols: Array<{ symbol: string; sentiment: string | null }> }>;
};

describe("social discovery tools", () => {
  const apiCallLogRepo = {
    insert: vi.fn(),
  };

  it("returns mock reddit posts when provided", async () => {
    const tool = createSearchRedditTool({
      sessionId: "s1",
      apiCallLogRepo: apiCallLogRepo as never,
      instrumentClasses: ["stock", "crypto"],
      mockPosts: MOCK_REDDIT_POSTS,
    }) as unknown as RedditExecutor;

    const result = await tool.execute({ query: "breakout", sort: "top", timeFilter: "day" });

    expect(result.posts.length).toBeGreaterThan(0);
    expect(result.posts[0]?.body.length).toBeGreaterThan(0);
    expect(result.subreddits).toContain("stocks");
    expect(result.subreddits).toContain("CryptoMarkets");
  });

  it("returns mock trending symbols when provided", async () => {
    const tool = createTrendingSymbolsTool({
      sessionId: "s1",
      apiCallLogRepo: apiCallLogRepo as never,
      mockSymbols: MOCK_TRENDING_SYMBOLS,
    }) as unknown as TrendingExecutor;

    const result = await tool.execute();

    expect(result.symbols).toHaveLength(MOCK_TRENDING_SYMBOLS.length);
    expect(result.symbols[0]).toMatchObject({ symbol: "NVDA", sentiment: "Bullish" });
  });
});
