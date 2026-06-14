import { describe, expect, it } from "vitest";
import { tradeSignalSchema } from "../trade-signals";
import { candidateSchema } from "../selector-candidate";
import {
  collectCandidateToolNames,
  selectorDiagnosticsSchema,
} from "../selector-diagnostics";
import {
  DEFAULT_PIPELINE_CONFIG,
  phaseSpendCapUsd,
  resolveTotalSpendCapUsd,
} from "../ai-phase-config";
import { PIPELINE_PHASES } from "../ai-phase";
import { signalForWorkerPrompt } from "../worker-prompt-payload";

describe("trade-signals schema", () => {
  it("accepts bounded confidence and sizing fields", () => {
    const parsed = tradeSignalSchema.parse({
      symbol: "AAPL",
      action: "buy",
      executionStrategy: "event_driven",
      confidence: 0.75,
      reasoning: "Strong catalyst",
    });
    expect(parsed.confidence).toBe(0.75);
  });

  it("rejects out-of-range confidence", () => {
    expect(() =>
      tradeSignalSchema.parse({
        symbol: "AAPL",
        action: "skip",
        executionStrategy: "trend_momentum",
        confidence: 1.5,
        reasoning: "Bad",
      }),
    ).toThrow();
  });
});

describe("selector-candidate schema", () => {
  it("validates candidate shape and rejection bounds", () => {
    expect(
      candidateSchema.parse({
        symbol: "NVDA",
        instrumentClass: "stock",
      }),
    ).toMatchObject({ symbol: "NVDA" });
    expect(() =>
      candidateSchema.parse({ symbol: "", instrumentClass: "stock" }),
    ).toThrow();
  });
});

describe("selector-diagnostics", () => {
  it("parses diagnostics payload and collects tool names", () => {
    expect(
      selectorDiagnosticsSchema.parse({
        discoveredCount: 5,
        verifiedCount: 3,
        acceptedCount: 1,
        rejected: [],
      }),
    ).toBeDefined();
    expect(
      collectCandidateToolNames([
        { step: 1, toolCalls: [{ tool: "search_web" }] },
        { step: 2, toolCalls: [{ tool: "search_web" }, { tool: "fetch_url" }] },
      ]),
    ).toEqual(["search_web", "fetch_url"]);
  });
});

describe("ai-phase-config", () => {
  it("defines pipeline phases and spend caps", () => {
    expect(PIPELINE_PHASES).toContain("selector");
    expect(DEFAULT_PIPELINE_CONFIG.totalSpendCapUsd).toBeGreaterThan(0);
    expect(phaseSpendCapUsd("selector")).toBe(0.3);
    expect(resolveTotalSpendCapUsd(false)).toBe(0.5);
    expect(resolveTotalSpendCapUsd(true)).toBe(25);
  });
});

describe("worker-prompt-payload", () => {
  it("strips rawSummary from worker prompt signals", () => {
    expect(
      signalForWorkerPrompt({
        symbol: "AAPL",
        trendDirection: "bullish",
        rawSummary: "verbose",
      }),
    ).toEqual({ symbol: "AAPL", trendDirection: "bullish" });
  });
});
