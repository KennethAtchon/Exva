import { describe, expect, it } from "vitest";
import {
  executionModeForEnvironment,
  sessionMatchesEnvironment,
  brokerModeForEnvironment,
} from "../domain/environment-mode";
import {
  canTransitionEvidenceRung,
  nextEvidenceRung,
  nextPromotionTier,
  PROMOTION_TIERS,
  EVIDENCE_RUNGS,
  resolveSessionPromotionTier,
} from "../domain/promotion-ladder";
import {
  isSearchStyleSignalSourceType,
  isSelfDescribingSignalSourceType,
  sessionRequiresInstrumentScope,
} from "../domain/signals";
import {
  extractSignalInstrumentClass,
  signalSourceEmitsClass,
  SIGNAL_SOURCE_CAPABILITIES,
} from "../domain/signal-source-capabilities";
import type { SignalEvent } from "../domain/signals";
import { parseAutopsyStructuredJson } from "../domain/autopsy";
import { isMockScenarioKind } from "../domain/mock-scenario";

describe("environment-mode", () => {
  it("maps paper/live to execution and broker modes", () => {
    expect(executionModeForEnvironment("paper")).toBe("paper_only");
    expect(executionModeForEnvironment("live")).toBe("live_allowed");
    expect(brokerModeForEnvironment("paper")).toBe("paper");
    expect(brokerModeForEnvironment("live")).toBe("live");
  });

  it("checks session/environment compatibility matrix", () => {
    expect(sessionMatchesEnvironment("paper_only", "paper")).toBe(true);
    expect(sessionMatchesEnvironment("live_allowed", "live")).toBe(true);
    expect(sessionMatchesEnvironment("paper_only", "live")).toBe(false);
    expect(sessionMatchesEnvironment("live_allowed", "paper")).toBe(false);
  });
});

describe("promotion-ladder", () => {
  it("advances through scripted → rehearsal → paper → live", () => {
    expect(nextPromotionTier("scripted")).toBe("rehearsal");
    expect(nextPromotionTier("rehearsal")).toBe("paper");
    expect(nextPromotionTier("paper")).toBe("live");
    expect(nextPromotionTier("live")).toBeNull();
  });

  it("resolves tier from execution mode and mock settings", () => {
    expect(
      resolveSessionPromotionTier({
        executionMode: "live_allowed",
        usesMockBroker: false,
      }),
    ).toBe("live");
    expect(
      resolveSessionPromotionTier({
        executionMode: "paper_only",
        usesMockBroker: true,
        mockExecutionTier: "scripted",
      }),
    ).toBe("scripted");
    expect(
      resolveSessionPromotionTier({
        executionMode: "paper_only",
        usesMockBroker: true,
        mockExecutionTier: "rehearsal",
      }),
    ).toBe("rehearsal");
    expect(
      resolveSessionPromotionTier({
        executionMode: "paper_only",
        usesMockBroker: false,
      }),
    ).toBe("paper");
  });

  it("covers all promotion tiers", () => {
    expect(PROMOTION_TIERS).toEqual(["scripted", "rehearsal", "paper", "live"]);
  });

  it("advances evidence rungs without skipping", () => {
    expect(EVIDENCE_RUNGS).toEqual([
      "backtest",
      "paper",
      "live_small",
      "live_scaled",
    ]);
    expect(nextEvidenceRung("backtest")).toBe("paper");
    expect(nextEvidenceRung("paper")).toBe("live_small");
    expect(nextEvidenceRung("live_small")).toBe("live_scaled");
    expect(nextEvidenceRung("live_scaled")).toBeNull();
    expect(canTransitionEvidenceRung("backtest", "paper")).toBe(true);
    expect(canTransitionEvidenceRung("backtest", "live_small")).toBe(false);
  });
});

describe("signals helpers", () => {
  it("classifies search-style vs self-describing sources", () => {
    // web_search is deprecated; search-style is always false.
    expect(isSearchStyleSignalSourceType("web_search")).toBe(false);
    expect(isSearchStyleSignalSourceType("edgar_8k")).toBe(false);
    expect(isSelfDescribingSignalSourceType("edgar_8k")).toBe(true);
    expect(isSelfDescribingSignalSourceType("web_search")).toBe(false);
    expect(isSelfDescribingSignalSourceType("manual")).toBe(false);
  });

  it("requires instrument scope for empty subscriptions (not deprecated web_search)", () => {
    expect(sessionRequiresInstrumentScope([])).toBe(true);
    expect(sessionRequiresInstrumentScope([{ type: "web_search" }])).toBe(
      false,
    );
    expect(sessionRequiresInstrumentScope([{ type: "edgar_8k" }])).toBe(false);
  });
});

describe("signal-source-capabilities", () => {
  const baseSignal = (overrides: Partial<SignalEvent> = {}): SignalEvent => ({
    id: "sig-1",
    sourceId: "src-1",
    sourceType: "edgar_8k",
    ticker: "AAPL",
    companyName: "Apple",
    documentUrl: null,
    accessionNumber: "0001",
    payloadJson: {},
    filedAt: new Date().toISOString(),
    detectedAt: new Date().toISOString(),
    ...overrides,
  });

  it("defines capability flags per source type", () => {
    expect(
      SIGNAL_SOURCE_CAPABILITIES.edgar_8k.emittedInstrumentClasses,
    ).toEqual(["stock"]);
    expect(
      SIGNAL_SOURCE_CAPABILITIES.prediction_event.emittedInstrumentClasses,
    ).toEqual(["prediction_market"]);
    expect(SIGNAL_SOURCE_CAPABILITIES.web_search.emittedInstrumentClasses).toBe(
      "from_config",
    );
  });

  it("extracts instrument class from payload or source type", () => {
    expect(extractSignalInstrumentClass(baseSignal())).toBe("stock");
    expect(
      extractSignalInstrumentClass(
        baseSignal({
          sourceType: "mock",
          payloadJson: { instrumentClass: "crypto" },
        }),
      ),
    ).toBe("crypto");
    expect(
      extractSignalInstrumentClass(
        baseSignal({ sourceType: "prediction_event" }),
      ),
    ).toBe("prediction_market");
  });

  it("checks class emission compatibility", () => {
    expect(signalSourceEmitsClass("edgar_8k", baseSignal(), "stock")).toBe(
      true,
    );
    expect(signalSourceEmitsClass("edgar_8k", baseSignal(), "crypto")).toBe(
      false,
    );
  });
});

describe("autopsy parsing", () => {
  it("parses structured autopsy JSON", () => {
    const parsed = parseAutopsyStructuredJson(
      JSON.stringify({
        executiveSummary: "Trade worked",
        thesisReview: {
          valid: true,
          analysis: "Thesis held",
          confirmatoryBias: false,
          prematureConviction: false,
          ignoredCounterSignals: [],
        },
        executionQuality: {
          entryTiming: "good",
          sizingAdequacy: "appropriate",
          exitManagement: "Clean exit",
          slippage: null,
        },
        behavioralFlags: [],
        marketContext: {
          regime: "trending",
          macro: "Risk-on",
          volatility: "Normal",
          suitability: "good_conditions",
        },
        whatWorked: ["Entry timing"],
        whatFailed: [],
        rootCause: null,
        processImprovements: [],
      }),
    );
    expect(parsed?.executiveSummary).toBe("Trade worked");
    expect(parseAutopsyStructuredJson("not-json")).toBeNull();
  });
});

describe("mock-scenario", () => {
  it("validates mock scenario kinds", () => {
    expect(isMockScenarioKind("clean_breakout")).toBe(true);
    expect(isMockScenarioKind("invalid_kind")).toBe(false);
  });
});
