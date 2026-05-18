import { describe, expect, it } from "vitest";
import { analyzeSelectorSteps } from "../selector-runtime-control";

describe("analyzeSelectorSteps", () => {
  it("captures duplicate query families, discovered symbols, and repeated symbol checks", () => {
    const summary = analyzeSelectorSteps([
      {
        toolCalls: [
          { toolCallId: "1", toolName: "search_web", input: { query: "NVDA AI momentum" } },
          { toolCallId: "2", toolName: "get_quote", input: { symbol: "NVDA" } },
          { toolCallId: "3", toolName: "get_quote", input: { symbol: "NVDA" } },
        ],
        toolResults: [
          {
            toolCallId: "1",
            output: {
              results: [
                { url: "https://example.com/nvda", title: "NVDA breaks out", snippet: "NVDA leads AI trade" },
                { url: "https://news.site/pltr", title: "PLTR strength", snippet: "PLTR joins momentum basket" },
              ],
            },
          },
        ],
      },
      {
        toolCalls: [
          { toolCallId: "4", toolName: "search_web", input: { query: "NVDA AI momentum" } },
          { toolCallId: "5", toolName: "submit_candidates", input: { instruments: [] } },
        ],
        toolResults: [],
      },
    ]);

    expect(summary.queryCount).toBe(2);
    expect(summary.duplicateQueryCount).toBe(1);
    expect(summary.uniqueSymbols).toEqual(expect.arrayContaining(["NVDA", "PLTR"]));
    expect(summary.uniqueDomains).toContain("example.com");
    expect(summary.repeatedSymbolChecks).toBe(1);
    expect(summary.maxRepeatedSymbolChecks).toBe(1);
    expect(summary.sawSubmitCandidates).toBe(true);
  });
});
