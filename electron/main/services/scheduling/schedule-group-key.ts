import { createHash } from "node:crypto";
import {
  serializeCadenceCanonical,
  type CadenceSpec,
} from "@electron/shared/domain/experience-inputs/cadence";

export interface ScheduleGroupKeyInput {
  templateId: string;
  templateVersion: number;
  pipelineId: string;
  strategyId: string;
  strategyImplementationVersion: number;
  instrumentSetId: string;
  instrumentSetRevision: number;
  cadence: CadenceSpec;
  analysisTimeframe: string;
  marketCalendarId: string;
  strategyParameters: Record<string, unknown>;
}

/**
 * Compute a stable SHA-256 group key from a set of scheduling parameters.
 * Two subscriptions with identical parameters collapse into the same group
 * and share a single timer + executor run.
 *
 * The key is deterministic: keys are sorted and cadences are normalized before
 * hashing so that semantically equivalent configurations produce the same key.
 */
export function computeScheduleGroupKey(input: ScheduleGroupKeyInput): string {
  const canonical = {
    analysisTimeframe: input.analysisTimeframe,
    cadence: serializeCadenceCanonical(input.cadence),
    instrumentSetId: input.instrumentSetId,
    instrumentSetRevision: input.instrumentSetRevision,
    marketCalendarId: input.marketCalendarId,
    pipelineId: input.pipelineId,
    strategyId: input.strategyId,
    strategyImplementationVersion: input.strategyImplementationVersion,
    // Sort parameter keys so that insertion order differences don't affect the hash.
    strategyParameters: JSON.stringify(
      Object.fromEntries(
        Object.keys(input.strategyParameters)
          .sort()
          .map((k) => [k, input.strategyParameters[k]]),
      ),
    ),
    templateId: input.templateId,
    templateVersion: input.templateVersion,
  };
  // Object keys are already in insertion order (sorted alphabetically above).
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
