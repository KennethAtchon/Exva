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
