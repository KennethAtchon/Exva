import type { ExperienceDescriptor } from "../types";

export const RULES_TREND_FOLLOWING_EXPERIENCE: ExperienceDescriptor = {
  id: "rules-trend-following",
  displayName: "Rules: Trend Following",
  description:
    "Deterministic SMA-crossover trend entries on timer-polled futures instruments. No LLM calls.",
  capabilities: {
    signalSourceTypes: ["timer"],
    brokerRequirement: "any_supported_class",
  },
  pipelineId: "rules-trend-following-cycle",
  defaultPresets: {
    posturePresetId: "manual_watchlist",
    rulesPresetId: "catalyst_entry",
    riskPresetId: "moderate",
    timeframePresetId: "swing",
  },
  promptVariantKey: "manual",
  researchContract: {
    hypothesis:
      "Futures contracts whose fast SMA crosses above the slow SMA continue trending over the next several 4h bars, net of costs.",
    tradableUniverse: ["GC", "CL"],
    instrumentClass: "futures",
    signalTimestamp: "continuous",
    label: { horizon: "5d", outcome: "net_return", benchmark: "cash" },
    validation: {
      minOutOfSampleTrades: 100,
      minNetExpectancyUsd: 0,
      minLowerBoundSharpe: 0,
      maxDrawdownPct: 0.2,
      requiredFolds: 3,
    },
    costs: { spreadBps: 2, slippageBps: 3, commissionBps: 1 },
  },
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
