import type { ExperienceDescriptor } from "../types";

export const PREDICTION_EVENT_EDGE_EXPERIENCE: ExperienceDescriptor = {
  id: "prediction-event-edge",
  displayName: "Prediction Event Edge",
  description:
    "AI-driven analysis of prediction-market odds/volume dislocations. Calls LLM for full cycle.",
  capabilities: {
    signalSourceTypes: ["prediction_event"],
    brokerRequirement: "polymarket_broker",
  },
  pipelineId: "prediction-event-cycle",
  defaultPresets: {
    posturePresetId: "prediction_event_edge",
    rulesPresetId: "probability_edge",
    riskPresetId: "prediction_market",
    timeframePresetId: "prediction",
  },
  promptVariantKey: "catalyst",
  researchContract: {
    hypothesis:
      "When a calibrated structured-evidence model estimates a binary market's true probability meaningfully above/below the market-implied mid, the market reprices toward the model estimate by resolution, net of spread and fees.",
    tradableUniverse: [],
    instrumentClass: "prediction_market",
    signalTimestamp: "continuous",
    label: {
      horizon: "resolution",
      outcome: "probability_market_resolution",
      benchmark: "market_implied_probability",
    },
    validation: {
      minOutOfSampleTrades: 100,
      minNetExpectancyUsd: 0,
      minLowerBoundSharpe: 0,
      maxDrawdownPct: 0.2,
      maxBrierScore: 0.25,
      requiredFolds: 3,
    },
    costs: { spreadBps: 50, slippageBps: 10, commissionBps: 0 },
  },
};
