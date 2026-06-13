import type { PipelineDescriptor } from "../services/pipeline/implementations/registry/pipeline-router";
import type { MockScenarioKind } from "@electron/shared/domain/mock-scenario";
import type { SignalSourceType } from "@electron/shared/domain";
import type { ExperienceCapabilities } from "@electron/shared/domain/experience";
import type { ScriptedWorkerOutputs } from "../services/broker/mock/mock-scenario-worker-outputs";

export type {
  ExperienceCapabilities,
  BrokerRequirement,
} from "@electron/shared/domain/experience";

export interface ExperienceDescriptor {
  id: string;
  displayName: string;
  capabilities: ExperienceCapabilities;
  signalSource: {
    type: SignalSourceType;
    defaultConfig: Record<string, unknown>;
  };
  pipeline: PipelineDescriptor;
  presets: {
    posturePresetId: string;
    rulesPresetId: string;
    riskPresetId: string;
    timeframePresetId: string;
  };
  mockFixtures: {
    defaultScenario: MockScenarioKind;
    scriptedWorkerOutputs: ScriptedWorkerOutputs;
  };
}
