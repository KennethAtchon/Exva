import { EDGAR_8K_PIPELINE } from "../../services/pipeline/implementations/registry/pipelines";
import { scriptedWorkerOutputsForScenario } from "../../services/broker/mock/mock-scenario-worker-outputs";
import type { ExperienceDescriptor } from "../types";

export const EDGAR_CATALYST_EXPERIENCE: ExperienceDescriptor = {
  id: "edgar-catalyst",
  displayName: "EDGAR 8-K catalyst drift",
  signalSource: {
    type: "edgar_8k",
    defaultConfig: {
      itemCodeWhitelist: ["1.01", "2.02", "8.01"],
      minFilingAgeMinutes: 0,
    },
  },
  pipeline: EDGAR_8K_PIPELINE,
  presets: {
    posturePresetId: "edgar_catalyst",
    rulesPresetId: "catalyst_entry",
    riskPresetId: "moderate",
    timeframePresetId: "catalyst",
  },
  mockFixtures: {
    defaultScenario: "clean_breakout",
    scriptedWorkerOutputs: scriptedWorkerOutputsForScenario("clean_breakout"),
  },
};
