import type { ExperienceDescriptor } from "../types";

/**
 * Options Flow Edge (Part D). Detects unusual options activity (UOA) on liquid
 * underlyings and trades on the directional read.
 *
 * v1 trades the underlying equity on the aggregated chain flow — it reuses the
 * existing, proven equity order path and is honest about risk. Contract-level,
 * defined-risk execution (long call/put or verticals chosen by
 * `selectOptionContract`) is the next phase; the deterministic detector and
 * contract selector it needs are already built and unit-tested.
 *
 * Disabled by default and paper-only until the research contract's 100-trade
 * out-of-sample bar is met.
 */
export const OPTIONS_FLOW_EDGE_EXPERIENCE: ExperienceDescriptor = {
  id: "options-flow-edge",
  displayName: "Options Flow Edge",
  description:
    "Detects unusual options activity (volume >> open interest with directional skew) on liquid underlyings and trades the resulting directional read. Deterministic; no LLM calls in v1.",
  capabilities: {
    signalSourceTypes: [],
    brokerRequirement: "any_supported_class",
  },
  pipelineId: "options-flow-cycle",
  defaultPresets: {
    posturePresetId: "manual_watchlist",
    rulesPresetId: "catalyst_entry",
    riskPresetId: "moderate",
    timeframePresetId: "swing",
  },
  promptVariantKey: "manual",
  researchContract: {
    hypothesis:
      "On liquid large-caps, sessions where option volume runs well above standing open interest with a directional call/put skew precede an abnormal move in the underlying within the holding window, net of costs.",
    tradableUniverse: ["AAPL", "NVDA"],
    instrumentClass: "stock",
    signalTimestamp: "intraday",
    label: { horizon: "5d", outcome: "net_return", benchmark: "cash" },
    validation: {
      minOutOfSampleTrades: 100,
      minNetExpectancyUsd: 0,
      minLowerBoundSharpe: 0,
      maxDrawdownPct: 0.25,
      requiredFolds: 3,
    },
    // Options-derived flow on liquid names; trading the underlying keeps costs
    // low, but the signal still has to clear a real hurdle.
    costs: { spreadBps: 2, slippageBps: 3, commissionBps: 0 },
  },
  acceptsScanHit: true,
};
