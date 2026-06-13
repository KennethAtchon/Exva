import { RULES_MEAN_REVERSION_PIPELINE } from "../../services/pipeline/implementations/registry/pipelines";
import type { ExperienceDescriptor } from "../types";

export const BTC_MOMENTUM_BREAKOUT_EXPERIENCE: ExperienceDescriptor = {
  id: "btc-momentum-breakout",
  displayName: "BTC-USD 1h momentum breakout (rules)",
  capabilities: {
    instrumentClasses: ["crypto"],
    signalSourceTypes: ["timer"],
    brokerRequirement: "any_supported_class",
    defaultInstrumentClass: "crypto",
  },
  signalSource: {
    type: "timer",
    defaultConfig: {
      symbol: "BTC-USD",
      cadence: "1h",
      instrumentClass: "crypto",
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
