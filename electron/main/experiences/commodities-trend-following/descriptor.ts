import { RULES_TREND_FOLLOWING_PIPELINE } from "../../services/pipeline/implementations/registry/pipelines";
import type { ExperienceDescriptor } from "../types";

export const COMMODITIES_TREND_FOLLOWING_EXPERIENCE: ExperienceDescriptor = {
  id: "commodities-trend-following",
  displayName: "GC/CL 4h trend following (rules)",
  capabilities: {
    instrumentClasses: ["futures"],
    signalSourceTypes: ["timer"],
    brokerRequirement: "any_supported_class",
    defaultInstrumentClass: "futures",
  },
  signalSource: {
    type: "timer",
    defaultConfig: {
      symbol: "GC",
      cadence: "4h",
      instrumentClass: "futures",
    },
  },
  pipeline: RULES_TREND_FOLLOWING_PIPELINE,
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
