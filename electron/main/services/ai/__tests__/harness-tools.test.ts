import { describe, expect, it } from "vitest";
import { deriveHarnessToolAvailability } from "../ai-runtime/harness-tools";
import { ROLE_TOOL_POLICY } from "../ai-runtime/ai-runtime-types";

describe("deriveHarnessToolAvailability", () => {
  it("enables full selector toolset when search and broker wiring are available", () => {
    expect(deriveHarnessToolAvailability(ROLE_TOOL_POLICY.instrument_selector, "search-1", true)).toEqual({
      searchWeb: true,
      getNews: true,
      getQuote: true,
      getOhlcv: true,
      submitCandidates: true,
    });
  });

  it("keeps search_web disabled without a search provider", () => {
    expect(deriveHarnessToolAvailability(ROLE_TOOL_POLICY.instrument_selector, null, true)).toMatchObject({
      searchWeb: false,
      getNews: false,
      getQuote: true,
      getOhlcv: true,
      submitCandidates: true,
    });
  });

  it("allows mocked get_news while keeping live search_web dependent on provider", () => {
    expect(deriveHarnessToolAvailability(ROLE_TOOL_POLICY.instrument_selector, "search-1", true, true)).toMatchObject({
      searchWeb: true,
      getNews: true,
    });
  });
});
