import { describe, expect, it } from "vitest";
import {
  filterMockWebSearch,
  SCENARIO_WEB_SEARCH,
} from "./mock-discovery-fixtures";

describe("mock discovery fixtures", () => {
  it("returns bullish NVDA search results without live providers", () => {
    const results = filterMockWebSearch(
      SCENARIO_WEB_SEARCH.clean_breakout,
      "NVDA breakout momentum continuation",
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.title).toContain("NVDA");
    expect(results[0]?.url).toContain("mock.local");
    expect(results.every((row) => !row.title.includes("{symbol}"))).toBe(true);
  });
});
