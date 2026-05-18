import { describe, expect, it } from "vitest";
import type { ResolvedSelectorRoleSettings } from "@electron/shared/ai/ai-role-profile";
import type { HarnessToolAvailability } from "../../pipeline-runtime/context/tool-factory-registry";
import { analyzeSelectorSteps, buildSelectorPrepareStep } from "../selector-runtime-control";

const availability: HarnessToolAvailability = {
  searchWeb: true,
  fetchUrl: true,
  searchReddit: true,
  trendingSymbols: true,
  getNews: true,
  getQuote: true,
  getOhlcv: true,
  submitCandidates: true,
};

const settings: ResolvedSelectorRoleSettings = {
  noInstrumentRetryMinutes: 5,
  maxDiscoverySteps: 3,
  maxVerificationSteps: 2,
  maxNoNewInfoSteps: 1,
  maxRepeatedSymbolChecks: 2,
  minCandidatesBeforeVerification: 2,
  forceSubmitAfterStep: 6,
};

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

describe("buildSelectorPrepareStep", () => {
  it("forces search_web on step 0 when available", () => {
    const prepareStep = buildSelectorPrepareStep(availability, settings);
    const result = prepareStep({ stepNumber: 0, steps: [], model: {} as never, messages: [] });

    expect(result).toMatchObject({
      activeTools: ["search_web"],
      toolChoice: { type: "tool", toolName: "search_web" },
    });
  });

  it("moves into verification when enough unique candidates have been seen", () => {
    const prepareStep = buildSelectorPrepareStep(availability, settings);
    const result = prepareStep({
      stepNumber: 2,
      steps: [
        {
          toolCalls: [{ toolCallId: "1", toolName: "search_web", input: { query: "NVDA AI momentum" } }],
          toolResults: [{ toolCallId: "1", output: { results: [{ url: "https://example.com/nvda", title: "NVDA strength", snippet: "NVDA breakout" }, { url: "https://example.com/pltr", title: "PLTR breakout", snippet: "PLTR joins momentum" }] } }],
        },
      ] as never,
      model: {} as never,
      messages: [],
    });

    expect(result).toMatchObject({ activeTools: ["get_quote", "get_news", "get_ohlcv", "fetch_url"] });
  });

  it("forces submit_candidates after the force-submit step", () => {
    const prepareStep = buildSelectorPrepareStep(availability, settings);
    const result = prepareStep({ stepNumber: 6, steps: [], model: {} as never, messages: [] });

    expect(result).toMatchObject({
      activeTools: ["submit_candidates", "get_quote", "get_news", "get_ohlcv", "fetch_url"],
      toolChoice: { type: "tool", toolName: "submit_candidates" },
    });
  });
});
