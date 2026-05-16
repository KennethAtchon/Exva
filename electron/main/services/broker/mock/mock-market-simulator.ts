import { MockBrokerAdapter, type MockScenario } from "../adapters/mock-adapter";
import { type MockScenarioKind, SCENARIO_NEWS, SCENARIO_REDDIT, SCENARIO_TRENDING } from "./mock-scenario-fixtures";

const SCENARIO_CONFIG: Record<MockScenarioKind, MockScenario> = {
  clean_breakout: { bias: "bullish", volatilityPct: 0.012, trendPctPerDay: 0.008, kind: "clean_breakout" },
  failed_breakout: { bias: "bearish", volatilityPct: 0.022, trendPctPerDay: -0.007, kind: "failed_breakout" },
  sideways_chop: { bias: "sideways", volatilityPct: 0.010, trendPctPerDay: 0.0, kind: "sideways_chop" },
  gap_down_after_entry: { bias: "bearish", volatilityPct: 0.040, trendPctPerDay: -0.025, kind: "gap_down_after_entry" },
  news_reversal: { bias: "volatile", volatilityPct: 0.035, trendPctPerDay: -0.010, kind: "news_reversal" },
  stale_quote: { bias: "sideways", volatilityPct: 0.010, trendPctPerDay: 0.0, kind: "stale_quote" },
  wide_spread: { bias: "sideways", volatilityPct: 0.015, trendPctPerDay: 0.0, kind: "wide_spread" },
  partial_fill: { bias: "bullish", volatilityPct: 0.015, trendPctPerDay: 0.005, kind: "partial_fill" },
  broker_reject: { bias: "bullish", volatilityPct: 0.012, trendPctPerDay: 0.006, kind: "broker_reject" },
  rate_limit: { bias: "bullish", volatilityPct: 0.012, trendPctPerDay: 0.006, kind: "rate_limit" },
};

/** Expected policy outcome per scenario kind, for test assertions. */
export const SCENARIO_EXPECTED_OUTCOME: Record<MockScenarioKind, "allowed" | "rejected"> = {
  clean_breakout: "allowed",
  failed_breakout: "allowed",
  sideways_chop: "allowed",
  gap_down_after_entry: "allowed",
  news_reversal: "allowed",
  stale_quote: "rejected",
  wide_spread: "rejected",
  partial_fill: "allowed",
  broker_reject: "rejected",
  rate_limit: "rejected",
};

export const MockMarketSimulator = {
  createAdapter(kind: MockScenarioKind): MockBrokerAdapter {
    return new MockBrokerAdapter(SCENARIO_CONFIG[kind]);
  },
  fixturesFor(kind: MockScenarioKind) {
    return {
      news: SCENARIO_NEWS[kind],
      redditPosts: SCENARIO_REDDIT[kind],
      trendingSymbols: SCENARIO_TRENDING[kind],
    };
  },
};
