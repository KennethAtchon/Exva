import { MockBrokerAdapter, type MockScenario } from "../adapters/mock-adapter";
import type { MockScenarioKind } from "@electron/shared/domain/mock-scenario";
import {
  SCENARIO_NEWS,
  SCENARIO_REDDIT,
  SCENARIO_TRENDING,
} from "./mock-scenario-fixtures";
import {
  SCENARIO_PRIMARY_SYMBOLS,
  SCENARIO_URL_CONTENT,
  SCENARIO_WEB_SEARCH,
} from "./mock-discovery-fixtures";

const AUTO_CLOSE_MS = 30_000;

const SCENARIO_CONFIG: Record<MockScenarioKind, MockScenario> = {
  clean_breakout: {
    bias: "bullish",
    volatilityPct: 0.012,
    trendPctPerDay: 0.008,
    kind: "clean_breakout",
    autoCloseAfterMs: AUTO_CLOSE_MS,
  },
  failed_breakout: {
    bias: "bearish",
    volatilityPct: 0.022,
    trendPctPerDay: -0.007,
    kind: "failed_breakout",
    autoCloseAfterMs: AUTO_CLOSE_MS,
  },
  sideways_chop: {
    bias: "sideways",
    volatilityPct: 0.01,
    trendPctPerDay: 0.0,
    kind: "sideways_chop",
  },
  gap_down_after_entry: {
    bias: "bearish",
    volatilityPct: 0.04,
    trendPctPerDay: -0.025,
    kind: "gap_down_after_entry",
    autoCloseAfterMs: AUTO_CLOSE_MS,
  },
  news_reversal: {
    bias: "volatile",
    volatilityPct: 0.035,
    trendPctPerDay: -0.01,
    kind: "news_reversal",
    autoCloseAfterMs: AUTO_CLOSE_MS,
  },
  stale_quote: {
    bias: "sideways",
    volatilityPct: 0.01,
    trendPctPerDay: 0.0,
    kind: "stale_quote",
  },
  wide_spread: {
    bias: "sideways",
    volatilityPct: 0.015,
    trendPctPerDay: 0.0,
    kind: "wide_spread",
  },
  partial_fill: {
    bias: "bullish",
    volatilityPct: 0.015,
    trendPctPerDay: 0.005,
    kind: "partial_fill",
    autoCloseAfterMs: AUTO_CLOSE_MS,
  },
  broker_reject: {
    bias: "bullish",
    volatilityPct: 0.012,
    trendPctPerDay: 0.006,
    kind: "broker_reject",
  },
  rate_limit: {
    bias: "bullish",
    volatilityPct: 0.012,
    trendPctPerDay: 0.006,
    kind: "rate_limit",
  },
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
      webSearch: SCENARIO_WEB_SEARCH[kind],
      urlContent: SCENARIO_URL_CONTENT[kind],
      primarySymbols: SCENARIO_PRIMARY_SYMBOLS[kind],
    };
  },
};
