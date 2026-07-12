import type { ExperienceDescriptor } from "../types";

export const RULES_BREAKOUT_EXPERIENCE: ExperienceDescriptor = {
  id: "rules-breakout",
  displayName: "Rules: Momentum Breakout",
  description:
    "Deterministic resistance-breakout entries on scheduled crypto scans. No LLM calls.",
  capabilities: {
    signalSourceTypes: [],
    brokerRequirement: "any_supported_class",
  },
  pipelineId: "rules-breakout-cycle",
  defaultPresets: {
    posturePresetId: "manual_watchlist",
    rulesPresetId: "catalyst_entry",
    riskPresetId: "moderate",
    timeframePresetId: "swing",
  },
  promptVariantKey: "manual",
  researchContract: {
    hypothesis:
      "Crypto instruments that break above recent resistance continue higher over the next several 4h bars, net of costs.",
    tradableUniverse: ["BTC-USD"],
    instrumentClass: "crypto",
    signalTimestamp: "continuous",
    label: { horizon: "1d", outcome: "net_return", benchmark: "cash" },
    validation: {
      minOutOfSampleTrades: 100,
      minNetExpectancyUsd: 0,
      minLowerBoundSharpe: 0,
      maxDrawdownPct: 0.2,
      requiredFolds: 3,
    },
    costs: { spreadBps: 5, slippageBps: 8, commissionBps: 10 },
  },
  signals: [],
  schedules: [
    {
      id: "btc-1h-breakout",
      instrumentClass: "crypto",
      symbol: "BTC-USD",
      cadence: "1h",
      defaultAnalysisTimeframe: "4h",
      enabledByDefault: true,
      marketHours: "24_7",
      mockFixtures: {
        defaultScenario: "clean_breakout",
        scriptedWorkerOutputs: {},
      },
    },
  ],
};
