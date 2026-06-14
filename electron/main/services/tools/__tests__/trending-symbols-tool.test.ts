import { describe, expect, it } from "vitest";
import {
  createTrendingSymbolsTool,
  MOCK_TRENDING_SYMBOLS,
} from "../trending-symbols-tool";

type TrendingExecutor = {
  execute: () => Promise<{
    symbols?: Array<{ symbol: string }>;
    fetchedAt?: string;
    note?: string;
    error?: string;
  }>;
};

describe("trending-symbols-tool", () => {
  it("returns deterministic mock symbols without network access", async () => {
    const inserts: unknown[] = [];
    const tool = createTrendingSymbolsTool({
      sessionId: "s1",
      cycleId: "c1",
      apiCallLogRepo: { insert: (row: unknown) => inserts.push(row) } as never,
      mockSymbols: MOCK_TRENDING_SYMBOLS,
    });

    const executor = tool as unknown as TrendingExecutor;
    const out = await executor.execute();

    expect(out.symbols).toEqual(MOCK_TRENDING_SYMBOLS);
    expect(out.note).toMatch(/Retail sentiment signal only/);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      provider: "stocktwits",
      status: "mock",
      session_id: "s1",
      cycle_id: "c1",
    });
  });
});
