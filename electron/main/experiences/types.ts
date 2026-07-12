import type { ProcessingMode } from "@electron/shared/domain/enums";
import type { ExperienceCapabilities } from "@electron/shared/domain/experience";
import type { ExperienceResearchContract } from "@electron/shared/domain/research-contract";
import type {
  ExperiencePresetIds,
  ScheduledScanDescriptor,
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
  /** Event-driven signal sources (edgar_8k, prediction_event, …). */
  signals: SignalDescriptor[];
  /**
   * Clock-driven scans owned by SessionScheduler. Not SignalSourceTypes.
   * When non-empty, the experience accepts MarketSignal kind `scan_hit`.
   */
  schedules?: ScheduledScanDescriptor[];
  defaultPresets: ExperiencePresetIds;
  promptVariantKey: ProcessingMode;
  /**
   * Falsifiable research constitution (P0). Locked hypothesis, label
   * definition, validation thresholds, and cost model the strategy is judged
   * against. Read by backtests, promotion, and live readiness.
   */
  researchContract: ExperienceResearchContract;
}

/** True when the experience runs SessionScheduler scans and accepts scan_hit. */
export function experienceAcceptsScanHit(
  experience: Pick<ExperienceDescriptor, "schedules">,
): boolean {
  return (experience.schedules?.length ?? 0) > 0;
}
