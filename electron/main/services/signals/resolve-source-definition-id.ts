import type { SignalSourceType } from "@electron/shared/domain/signals";
import { SOURCE_DEFINITION_IDS } from "./source-definition-seeds";

const KNOWN_DEFINITION_IDS = new Set<string>(
  Object.values(SOURCE_DEFINITION_IDS),
);

/** Experience-era source ids that map 1:1 onto seeded definitions. */
const EXPERIENCE_SOURCE_ALIASES: Record<string, string> = {
  "edgar-catalyst/edgar-8k-catalyst": SOURCE_DEFINITION_IDS.EDGAR_8K_CATALYST,
  "prediction-event-edge/prediction-event-edge":
    SOURCE_DEFINITION_IDS.PREDICTION_EVENT_EDGE,
};

/**
 * Resolve a live `signal_sources.id` + type to a V2 source definition id for
 * subscription fanout. Returns null when no definition applies (manual/unknown).
 */
export function resolveSourceDefinitionId(
  sourceId: string,
  sourceType: SignalSourceType | string,
): string | null {
  if (KNOWN_DEFINITION_IDS.has(sourceId)) {
    return sourceId;
  }
  const alias = EXPERIENCE_SOURCE_ALIASES[sourceId];
  if (alias) return alias;

  if (sourceId.includes("mock") || sourceType === "mock") {
    return SOURCE_DEFINITION_IDS.MOCK_REHEARSAL;
  }
  if (sourceType === "edgar_8k") {
    return SOURCE_DEFINITION_IDS.EDGAR_8K_CATALYST;
  }
  if (sourceType === "prediction_event") {
    return SOURCE_DEFINITION_IDS.PREDICTION_EVENT_EDGE;
  }
  if (sourceType === "kalshi_market") {
    return SOURCE_DEFINITION_IDS.KALSHI_MARKET;
  }
  if (sourceType === "calendar") {
    return SOURCE_DEFINITION_IDS.CALENDAR_EVENTS;
  }
  if (sourceType === "news_rss") {
    return SOURCE_DEFINITION_IDS.NEWS_RSS;
  }
  return null;
}
