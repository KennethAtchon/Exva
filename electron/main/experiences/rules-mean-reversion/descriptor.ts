import type { ExperienceDescriptor } from "../types";

export const RULES_MEAN_REVERSION_EXPERIENCE: ExperienceDescriptor = {
  id: "rules-mean-reversion",
  displayName: "Rules: Mean Reversion",
  description:
    "Deterministic mean-reversion entries on timer-polled liquid instruments. No LLM calls.",
  capabilities: {
    instrumentClasses: ["stock"],
    signalSourceTypes: ["timer"],
    brokerRequirement: "any_supported_class",
    defaultInstrumentClass: "stock",
  },
  pipelineId: "rules-mean-reversion-cycle",
  defaultPresets: {
    posturePresetId: "manual_watchlist",
    rulesPresetId: "catalyst_entry",
    riskPresetId: "moderate",
    timeframePresetId: "swing",
  },
  promptVariantKey: "manual",
  signals: [
    {
      id: "spy-15m-meanrev",
      sourceType: "timer",
      instrumentClass: "stock",
      symbol: "SPY",
      pollCadence: "15m",
      defaultAnalysisTimeframe: "1h",
      enabledByDefault: true,
      mockFixtures: {
        defaultScenario: "clean_breakout",
        scriptedWorkerOutputs: {},
      },
    },
    {
      id: "qqq-15m-meanrev",
      sourceType: "timer",
      instrumentClass: "stock",
      symbol: "QQQ",
      pollCadence: "15m",
      defaultAnalysisTimeframe: "1h",
      enabledByDefault: true,
      mockFixtures: {
        defaultScenario: "clean_breakout",
        scriptedWorkerOutputs: {},
      },
    },
  ],
};
