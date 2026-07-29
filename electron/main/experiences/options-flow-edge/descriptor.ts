/**
 * Options Flow Edge v2 — UOA → defined-risk vertical spreads via Tradier
 * placeSpread (or single OCC leg on Alpaca). Forward-paper until point-in-time
 * chains exist for honest backtest (Solution 10 Tracer A).
 */
import type { ExperienceDescriptor } from "../types";

export const OPTIONS_FLOW_EDGE_EXPERIENCE: ExperienceDescriptor = {
  id: "options-flow-edge",
  displayName: "Options Flow Edge",
  description:
    "FORWARD_PAPER: chain→UOA→OCC/vertical composition is live; historical option-chain backtests remain out of scope.",
  capabilities: {
    signalSourceTypes: [],
    brokerRequirement: "any_supported_class",
  },
  pipelineId: "options-flow-cycle",
  supportState: "forward_paper_only",
  blockerMessage:
    "Forward-paper only until point-in-time option chain snapshots exist for backtest.",
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
    costs: { spreadBps: 40, slippageBps: 15, commissionBps: 10 },
  },
  acceptsScanHit: true,
};
