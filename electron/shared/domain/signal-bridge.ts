import type { SignalEvent, SignalSourceType } from "./signals";
import type { MarketSignal, MarketSignalKind } from "./market-signal";
import { DEFAULT_SIGNAL_TTL } from "./market-signal";

/**
 * Bridge between legacy SignalEvent (EDGAR-shaped) and MarketSignal union.
 * Dual-read period: bus accepts either; persistence writes both shapes.
 */

const SOURCE_TYPE_TO_KIND: Partial<Record<SignalSourceType, MarketSignalKind>> =
  {
    edgar_8k: "filing",
    prediction_event: "market_dislocation",
    manual: "manual",
    mock: "manual",
    web_search: "news",
  };

export function kindFromSourceType(
  sourceType: SignalSourceType,
): MarketSignalKind {
  return SOURCE_TYPE_TO_KIND[sourceType] ?? "manual";
}

/** Enrich a legacy SignalEvent with MarketSignal fields for dual-write. */
export function enrichSignalEvent(event: SignalEvent): SignalEvent {
  if (event.kind && event.dedupeKey && event.ttl) return event;
  const kind = event.kind ?? kindFromSourceType(event.sourceType);
  const ttl =
    event.ttl ?? DEFAULT_SIGNAL_TTL[kind as MarketSignalKind] ?? "PT4H";
  const dedupeKey =
    event.dedupeKey ??
    event.accessionNumber ??
    `${event.sourceId}:${event.ticker}:${event.detectedAt}`;
  return {
    ...event,
    kind,
    ttl,
    dedupeKey,
    occurredAt: event.occurredAt ?? event.filedAt ?? event.detectedAt,
    payloadV2: event.payloadV2 ?? event.payloadJson,
  };
}

/** Project MarketSignal into legacy SignalEvent for delivery gate / orchestrator. */
export function marketSignalToLegacyEvent(
  signal: MarketSignal,
  sourceType: SignalSourceType,
): SignalEvent {
  const ticker = signal.symbols[0] ?? "UNKNOWN";
  const filing = signal.kind === "filing" ? signal.payload : null;
  return {
    id: signal.id,
    sourceId: signal.sourceId,
    sourceType,
    ticker,
    companyName: filing?.companyName ?? null,
    documentUrl: filing?.documentUrl ?? signal.provenance.url ?? null,
    accessionNumber: filing?.accessionNumber ?? null,
    payloadJson: {
      ...signal.payload,
      instrumentClass: signal.instrumentClass,
      kind: signal.kind,
      symbols: signal.symbols,
      barWindowHash:
        signal.kind === "scan_hit" ? signal.payload.barWindowHash : undefined,
    },
    filedAt: signal.occurredAt,
    detectedAt: signal.detectedAt,
    kind: signal.kind,
    payloadV2: signal.payload as unknown as Record<string, unknown>,
    dedupeKey: signal.dedupeKey,
    ttl: signal.ttl,
    occurredAt: signal.occurredAt,
  };
}
