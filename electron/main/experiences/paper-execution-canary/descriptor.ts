import type { ExperienceDescriptor } from "../types";

/**
 * Paper execution canary — infrastructure certification only (Solution 01 / 05).
 * No alpha claim; no automatic schedule; manual arm only.
 */
export const PAPER_EXECUTION_CANARY_EXPERIENCE: ExperienceDescriptor = {
  id: "paper-execution-canary",
  displayName: "Paper Execution Canary",
  description:
    "System proof: one $10 SPY paper round-trip certification. Not a strategy trade.",
  capabilities: {
    signalSourceTypes: ["manual"],
    brokerRequirement: "any_supported_class",
    mockRehearsalEligible: false,
  },
  pipelineId: "paper-certification",
  supportState: "available",
  acceptsScanHit: false,
  defaultPresets: {
    posturePresetId: "manual_watchlist",
    rulesPresetId: "catalyst_entry",
    riskPresetId: "conservative",
    timeframePresetId: "catalyst",
  },
  promptVariantKey: "manual",
  researchContract: {
    hypothesis:
      "Infrastructure certification only — no alpha hypothesis. Excluded from promotion.",
    tradableUniverse: ["SPY"],
    instrumentClass: "stock",
    signalTimestamp: "intraday",
    label: { horizon: "1d", outcome: "net_return", benchmark: "cash" },
    validation: {
      minOutOfSampleTrades: 1,
      minNetExpectancyUsd: 0,
      minLowerBoundSharpe: 0,
      maxDrawdownPct: 1,
      requiredFolds: 1,
    },
    costs: { spreadBps: 1, slippageBps: 1, commissionBps: 0 },
  },
};
