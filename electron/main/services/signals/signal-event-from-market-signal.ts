import type {
  MarketSignal,
  SignalEvent,
  SignalSourceType,
} from "@electron/shared/domain";

/**
 * One-way projection: MarketSignal → SignalEvent for delivery / persistence
 * paths that still speak the SignalEvent shape (ticker, sourceType, EDGAR fields).
 * Not a dual-read bridge — MarketSignal is the source of truth.
 */
export function signalEventFromMarketSignal(
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
    dedupeKey: signal.dedupeKey,
    ttl: signal.ttl,
    occurredAt: signal.occurredAt,
  };
}

/** Fail loud if a SignalEvent is missing envelope fields required post-bridge. */
export function assertCompleteSignalEvent(event: SignalEvent): void {
  if (!event.kind || !event.dedupeKey || !event.ttl || !event.occurredAt) {
    throw new Error(
      `Incomplete SignalEvent ${event.id}: kind, dedupeKey, ttl, and occurredAt are required ` +
        `(got kind=${String(event.kind)}, dedupeKey=${String(event.dedupeKey)}, ` +
        `ttl=${String(event.ttl)}, occurredAt=${String(event.occurredAt)})`,
    );
  }
}
