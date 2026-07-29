import type { ExperienceDescriptor } from "../types";

export const RULES_TREND_FOLLOWING_EXPERIENCE: ExperienceDescriptor = {
  id: "rules-trend-following",
  displayName: "Rules: Trend Following",
  description:
    "BLOCKED: FUTURES_ADAPTER_SIMULATED — Tradovate cannot place/fill/close; use Mock paper for the local lifecycle sentinel only.",
  capabilities: {
    signalSourceTypes: [],
    brokerRequirement: "any_supported_class",
  },
  pipelineId: "rules-trend-following-cycle",
  supportState: "blocked",
  blockerCode: "FUTURES_ADAPTER_SIMULATED",
  blockerMessage:
    "Tradovate adapter is quarantined (throws UNSUPPORTED). Assign Mock paper to FUTURES-INTEGRATION-SENTINEL only.",
  defaultPresets: {
    posturePresetId: "manual_watchlist",
    rulesPresetId: "catalyst_entry",
    riskPresetId: "moderate",
    timeframePresetId: "swing",
  },
  promptVariantKey: "manual",
  researchContract: {
    hypothesis:
      "Futures contracts whose fast SMA crosses above the slow SMA continue trending over the next several 4h bars, net of costs.",
    tradableUniverse: ["GC", "CL"],
    instrumentClass: "futures",
    signalTimestamp: "continuous",
    label: { horizon: "5d", outcome: "net_return", benchmark: "cash" },
    validation: {
      minOutOfSampleTrades: 100,
      minNetExpectancyUsd: 0,
      minLowerBoundSharpe: 0,
      maxDrawdownPct: 0.2,
      requiredFolds: 3,
    },
    costs: { spreadBps: 2, slippageBps: 3, commissionBps: 1 },
  },
  acceptsScanHit: true,
};
