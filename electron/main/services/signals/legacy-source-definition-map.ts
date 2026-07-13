import type { SignalSourceType } from "@electron/shared/domain/signals";
import { SOURCE_DEFINITION_IDS } from "./source-definition-seeds";

/**
 * Map a live `signal_sources.id` (or type) to a V2 source definition id.
 * Returns null when no V2 definition applies (manual/unknown).
 */
export function mapLegacySourceToDefinitionId(
  sourceId: string,
  sourceType: SignalSourceType | string,
): string | null {
  if (
    sourceId === SOURCE_DEFINITION_IDS.EDGAR_8K_CATALYST ||
    sourceId === "edgar-catalyst/edgar-8k-catalyst"
  ) {
    return SOURCE_DEFINITION_IDS.EDGAR_8K_CATALYST;
  }
  if (
    sourceId === SOURCE_DEFINITION_IDS.PREDICTION_EVENT_EDGE ||
    sourceId === "prediction-event-edge/prediction-event-edge"
  ) {
    return SOURCE_DEFINITION_IDS.PREDICTION_EVENT_EDGE;
  }
  if (
    sourceId === SOURCE_DEFINITION_IDS.MOCK_REHEARSAL ||
    sourceId.includes("mock") ||
    sourceType === "mock"
  ) {
    return SOURCE_DEFINITION_IDS.MOCK_REHEARSAL;
  }
  if (sourceType === "edgar_8k") {
    return SOURCE_DEFINITION_IDS.EDGAR_8K_CATALYST;
  }
  if (sourceType === "prediction_event") {
    return SOURCE_DEFINITION_IDS.PREDICTION_EVENT_EDGE;
  }
  return null;
}
