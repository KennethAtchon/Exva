import type { ExperienceDescriptor } from "../types";

export const RULES_MEAN_REVERSION_EXPERIENCE: ExperienceDescriptor = {
  id: "rules-mean-reversion",
  displayName: "Rules: Mean Reversion",
  description:
    "Deterministic mean-reversion entries on scheduled liquid-instrument scans. No LLM calls.",
  capabilities: {
    signalSourceTypes: [],
    brokerRequirement: "any_supported_class",
  },
  pipelineId: "rules-mean-reversion-cycle",
  defaultPresets: {
    posturePresetId: "manual_watchlist",
    rulesPresetId: "catalyst_entry",
    riskPresetId: "moderate",
    timeframePresetId: "swing",
  },
  promptVariantKey: "manual",
  researchContract: {
    hypothesis:
      "Liquid equity ETFs that close ~2 std devs below their 20-bar mean revert toward the mean within one trading day, net of costs.",
    tradableUniverse: ["SPY", "QQQ"],
    instrumentClass: "stock",
    signalTimestamp: "intraday",
    label: { horizon: "1d", outcome: "net_return", benchmark: "SPY" },
    validation: {
      minOutOfSampleTrades: 100,
      minNetExpectancyUsd: 0,
      minLowerBoundSharpe: 0,
      maxDrawdownPct: 0.2,
      requiredFolds: 3,
    },
    costs: { spreadBps: 1, slippageBps: 2, commissionBps: 0 },
  },
  acceptsScanHit: true,
};
