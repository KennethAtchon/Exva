import type { ProcessingMode } from "@electron/shared/domain/enums";
import type { ExperienceCapabilities } from "@electron/shared/domain/experience";
import type { ExperienceResearchContract } from "@electron/shared/domain/research-contract";
import type { ExperiencePresetIds } from "@electron/shared/domain/signal-descriptor";

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
  /**
   * True when the experience accepts MarketSignal kind `scan_hit` from
   * ScheduleCoordinator. False (default) for event-driven experiences that
   * receive signals via subscription fan-out.
   */
  acceptsScanHit?: boolean;
  defaultPresets: ExperiencePresetIds;
  promptVariantKey: ProcessingMode;
  /**
   * Falsifiable research constitution (P0). Locked hypothesis, label
   * definition, validation thresholds, and cost model the strategy is judged
   * against. Read by backtests, promotion, and live readiness.
   */
  researchContract: ExperienceResearchContract;
}

/** True when the experience runs ScheduleCoordinator scans and accepts scan_hit. */
export function experienceAcceptsScanHit(
  experience: Pick<ExperienceDescriptor, "acceptsScanHit">,
): boolean {
  return experience.acceptsScanHit ?? false;
}
