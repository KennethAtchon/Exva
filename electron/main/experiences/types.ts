import type { ProcessingMode } from "@electron/shared/domain/enums";
import type { ExperienceCapabilities } from "@electron/shared/domain/experience";
import type {
  ExperiencePresetIds,
  SignalDescriptor,
} from "@electron/shared/domain/signal-descriptor";

export type {
  ExperienceCapabilities,
  BrokerRequirement,
} from "@electron/shared/domain/experience";

export interface ExperienceDescriptor {
  id: string;
  displayName: string;
  description: string;
  capabilities: ExperienceCapabilities;
  pipelineId: string;
  signals: SignalDescriptor[];
  defaultPresets: ExperiencePresetIds;
  promptVariantKey: ProcessingMode;
}
