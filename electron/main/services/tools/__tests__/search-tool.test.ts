import { describe, expect, it } from "vitest";
import { createMockSearchTool } from "../search-tool";

type SearchExecutor = {
  execute: (input: { query: string }) => Promise<{
    results?: unknown[];
    query?: string;
    provider?: string;
    error?: string;
  }>;
};

describe("search-tool", () => {
  it("filters mock web search fixtures and logs the call", async () => {
    const inserts: unknown[] = [];
    const tool = createMockSearchTool({
      sessionId: "s1",
      cycleId: "c1",
      tradeId: null,
      apiCallLogRepo: { insert: (row: unknown) => inserts.push(row) } as never,
      mockWebSearchData: [
        {
          title: "NVDA breakout watch",
          url: "https://example.com/nvda",
          snippet: "NVIDIA momentum NVDA",
          publishedDate: new Date().toISOString(),
        },
        {
          title: "Unrelated macro",
          url: "https://example.com/macro",
          snippet: "Fed commentary",
          publishedDate: new Date().toISOString(),
        },
      ],
      mockPrimarySymbols: ["NVDA"],
    });

    const executor = tool as unknown as SearchExecutor;
    const out = await executor.execute({ query: "NVDA breakout" });

    expect(out.provider).toBe("mock");
    expect(out.results?.length).toBeGreaterThan(0);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      session_id: "s1",
      cycle_id: "c1",
      call_type: "search",
      status: "ok",
      from_cache: true,
    });
  });
});
