import type { ExperienceDescriptor } from "../types";

export const RULES_BREAKOUT_EXPERIENCE: ExperienceDescriptor = {
  id: "rules-breakout",
  displayName: "Rules: Momentum Breakout",
  description:
    "Deterministic resistance-breakout entries on timer-polled crypto instruments. No LLM calls.",
  capabilities: {
    instrumentClasses: ["crypto"],
    signalSourceTypes: ["timer"],
    brokerRequirement: "any_supported_class",
    defaultInstrumentClass: "crypto",
  },
  pipelineId: "rules-breakout-cycle",
  defaultPresets: {
    posturePresetId: "manual_watchlist",
    rulesPresetId: "catalyst_entry",
    riskPresetId: "moderate",
    timeframePresetId: "swing",
  },
  promptVariantKey: "manual",
  signals: [
    {
      id: "btc-1h-breakout",
      sourceType: "timer",
      instrumentClass: "crypto",
      symbol: "BTC-USD",
      pollCadence: "1h",
      defaultAnalysisTimeframe: "4h",
      enabledByDefault: true,
      mockFixtures: {
        defaultScenario: "clean_breakout",
        scriptedWorkerOutputs: {},
      },
    },
  ],
};
