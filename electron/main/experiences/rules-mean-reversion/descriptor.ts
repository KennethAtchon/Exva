import { RULES_MEAN_REVERSION_PIPELINE } from "../../services/pipeline/implementations/registry/pipelines";
import type { ExperienceDescriptor } from "../types";

export const RULES_MEAN_REVERSION_EXPERIENCE: ExperienceDescriptor = {
  id: "rules-mean-reversion",
  displayName: "SPY 15m mean reversion (rules)",
  capabilities: {
    instrumentClasses: ["stock"],
    signalSourceTypes: ["timer"],
    brokerRequirement: "any_supported_class",
    defaultInstrumentClass: "stock",
  },
  signalSource: {
    type: "timer",
    defaultConfig: {
      symbol: "SPY",
      cadence: "15m",
      instrumentClass: "stock",
    },
  },
  pipeline: RULES_MEAN_REVERSION_PIPELINE,
  presets: {
    posturePresetId: "manual_watchlist",
    rulesPresetId: "catalyst_entry",
    riskPresetId: "moderate",
    timeframePresetId: "swing",
  },
  promptVariantKey: "manual",
  mockFixtures: {
    defaultScenario: "clean_breakout",
    scriptedWorkerOutputs: {},
  },
};
