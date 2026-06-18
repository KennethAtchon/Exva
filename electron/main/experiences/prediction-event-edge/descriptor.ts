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
  signals: [
    {
      id: "prediction-event-edge",
      sourceType: "prediction_event",
      instrumentClass: "prediction_market",
      symbol: null,
      pollCadence: null,
      defaultAnalysisTimeframe: "1h",
      enabledByDefault: true,
      mockFixtures: {
        defaultScenario: "clean_breakout",
        scriptedWorkerOutputs: {},
      },
    },
  ],
};
