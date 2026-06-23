import { scriptedWorkerOutputsForScenario } from "../../services/broker/mock/mock-scenario-worker-outputs";
import type { ExperienceDescriptor } from "../types";

export const EDGAR_CATALYST_EXPERIENCE: ExperienceDescriptor = {
  id: "edgar-catalyst",
  displayName: "EDGAR Catalyst",
  description:
    "AI-driven analysis of 8-K filings for catalyst-based drift plays. Calls LLM for fundamental + review + decision phases.",
  capabilities: {
    signalSourceTypes: ["edgar_8k"],
    brokerRequirement: "any_supported_class",
    mockRehearsalEligible: true,
  },
  pipelineId: "edgar-8k-cycle",
  defaultPresets: {
    posturePresetId: "edgar_catalyst",
    rulesPresetId: "catalyst_entry",
    riskPresetId: "moderate",
    timeframePresetId: "catalyst",
  },
  promptVariantKey: "catalyst",
  researchContract: {
    hypothesis:
      "Certain 8-K filing types produce delayed price repricing: after controlling for SPY/sector return, a structured filing surprise predicts abnormal return over 1-5 days net of cost.",
    tradableUniverse: [],
    instrumentClass: "stock",
    signalTimestamp: "continuous",
    label: { horizon: "5d", outcome: "net_return", benchmark: "SPY" },
    validation: {
      minOutOfSampleTrades: 100,
      minNetExpectancyUsd: 0,
      minLowerBoundSharpe: 0,
      maxDrawdownPct: 0.2,
      requiredFolds: 3,
    },
    costs: { spreadBps: 3, slippageBps: 5, commissionBps: 0 },
  },
  signals: [
    {
      id: "edgar-8k-catalyst",
      sourceType: "edgar_8k",
      instrumentClass: "stock",
      symbol: null,
      pollCadence: null,
      defaultAnalysisTimeframe: "1d",
      enabledByDefault: true,
      mockFixtures: {
        defaultScenario: "clean_breakout",
        scriptedWorkerOutputs:
          scriptedWorkerOutputsForScenario("clean_breakout"),
      },
    },
  ],
};
