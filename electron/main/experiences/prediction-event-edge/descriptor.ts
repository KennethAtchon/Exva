import { PREDICTION_EVENT_PIPELINE } from "../../services/pipeline/implementations/registry/pipelines";
import type { ExperienceDescriptor } from "../types";

export const PREDICTION_EVENT_EDGE_EXPERIENCE: ExperienceDescriptor = {
  id: "prediction-event-edge",
  displayName: "Prediction event edge",
  capabilities: {
    instrumentClasses: ["prediction_market"],
    signalSourceTypes: ["prediction_event"],
    brokerRequirement: "polymarket_broker",
    defaultInstrumentClass: "prediction_market",
  },
  signalSource: {
    type: "prediction_event",
    defaultConfig: {
      triggerKind: "odds_volume_dislocation",
      pollIntervalMinutes: 15,
      minLiquidityUsd: 5000,
      minPriceDeviation: 0.12,
      categoryWhitelist: [],
    },
  },
  pipeline: PREDICTION_EVENT_PIPELINE,
  presets: {
    posturePresetId: "prediction_event_edge",
    rulesPresetId: "probability_edge",
    riskPresetId: "prediction_market",
    timeframePresetId: "prediction",
  },
  promptVariantKey: "catalyst",
  mockFixtures: {
    defaultScenario: "clean_breakout",
    scriptedWorkerOutputs: {},
  },
};
