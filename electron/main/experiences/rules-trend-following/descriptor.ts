import type { ExperienceDescriptor } from "../types";

export const RULES_TREND_FOLLOWING_EXPERIENCE: ExperienceDescriptor = {
  id: "rules-trend-following",
  displayName: "Rules: Trend Following",
  description:
    "Deterministic SMA-crossover trend entries on timer-polled futures instruments. No LLM calls.",
  capabilities: {
    instrumentClasses: ["futures"],
    signalSourceTypes: ["timer"],
    brokerRequirement: "any_supported_class",
    defaultInstrumentClass: "futures",
  },
  pipelineId: "rules-trend-following-cycle",
  defaultPresets: {
    posturePresetId: "manual_watchlist",
    rulesPresetId: "catalyst_entry",
    riskPresetId: "moderate",
    timeframePresetId: "swing",
  },
  promptVariantKey: "manual",
  signals: [
    {
      id: "gc-4h-trend",
      sourceType: "timer",
      instrumentClass: "futures",
      symbol: "GC",
      pollCadence: "4h",
      defaultAnalysisTimeframe: "4h",
      enabledByDefault: true,
      mockFixtures: {
        defaultScenario: "clean_breakout",
        scriptedWorkerOutputs: {},
      },
    },
    {
      id: "cl-4h-trend",
      sourceType: "timer",
      instrumentClass: "futures",
      symbol: "CL",
      pollCadence: "4h",
      defaultAnalysisTimeframe: "4h",
      enabledByDefault: true,
      mockFixtures: {
        defaultScenario: "clean_breakout",
        scriptedWorkerOutputs: {},
      },
    },
  ],
};
