import type { ExperienceDescriptor } from "../types";

/**
 * Options Flow Edge v2 — UOA → defined-risk vertical spreads via Tradier
 * placeSpread. Evidence class: forward-paper (historical option chains out of
 * reach for honest backtest). UI must label paper evidence accordingly.
 */
export const OPTIONS_FLOW_EDGE_EXPERIENCE: ExperienceDescriptor = {
  id: "options-flow-edge",
  displayName: "Options Flow Edge",
  description:
    "BLOCKED: OPTIONS_PRODUCER_UNREACHABLE — scheduled options evaluator returns null; no option chain reaches the pipeline. Sentinel only until Solution 10.",
  capabilities: {
    signalSourceTypes: [],
    brokerRequirement: "any_supported_class",
  },
  pipelineId: "options-flow-cycle",
  /** Unreachable producer — not assignable to non-sentinel sessions. */
  supportState: "blocked",
  blockerCode: "OPTIONS_PRODUCER_UNREACHABLE",
  blockerMessage:
    "Scheduled options evaluator returns null; no option chain reaches the pipeline.",
  defaultPresets: {
    posturePresetId: "manual_watchlist",
    rulesPresetId: "catalyst_entry",
    riskPresetId: "moderate",
    timeframePresetId: "swing",
  },
  promptVariantKey: "manual",
  researchContract: {
    hypothesis:
      "On liquid large-caps, UOA with directional skew precedes an abnormal move; defined-risk debit verticals capture that move with max loss = net debit, net of two-leg spreads + commissions.",
    tradableUniverse: ["AAPL", "NVDA"],
    instrumentClass: "options",
    signalTimestamp: "intraday",
    label: { horizon: "5d", outcome: "net_return", benchmark: "cash" },
    validation: {
      minOutOfSampleTrades: 50,
      minNetExpectancyUsd: 0,
      minLowerBoundSharpe: 0,
      maxDrawdownPct: 0.25,
      requiredFolds: 3,
    },
    // Two legs: wider effective spread + commissions than underlying equity.
    costs: { spreadBps: 40, slippageBps: 15, commissionBps: 10 },
  },
  acceptsScanHit: true,
};
