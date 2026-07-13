import type { DbClient } from "../../../db/client";
import { signalEvents } from "../../../db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { SignalEvent } from "@electron/shared/domain";

export class SignalEventsRepo {
  constructor(private readonly db: DbClient) {}

  insert(event: SignalEvent): void {
    this.db.db
      .insert(signalEvents)
      .values({
        id: event.id,
        sourceId: event.sourceId ?? null,
        sourceType: event.sourceType,
        ticker: event.ticker,
        companyName: event.companyName,
        documentUrl: event.documentUrl,
        accessionNumber: event.accessionNumber,
        payloadJson: JSON.stringify(event.payloadJson),
        filedAt: event.filedAt,
        detectedAt: event.detectedAt,
        dispatchStatus: "new",
        kind: event.kind ?? null,
        payloadV2: event.payloadV2 ? JSON.stringify(event.payloadV2) : null,
        dedupeKey: event.dedupeKey ?? null,
        ttl: event.ttl ?? null,
        occurredAt: event.occurredAt ?? null,
      })
      .run();
  }

  /**
   * Insert a V2 scheduled-scan event that carries additional origin metadata.
   * sourceId is null for scheduled-scan events (no real signal_sources row).
   */
  insertScheduledEvent(
    event: SignalEvent,
    v2: {
      originKind: string;
      originId: string;
      scheduleGroupKey: string;
    },
  ): void {
    this.db.db
      .insert(signalEvents)
      .values({
        id: event.id,
        sourceId: null,
        sourceType: event.sourceType,
        ticker: event.ticker,
        companyName: event.companyName,
        documentUrl: event.documentUrl,
        accessionNumber: event.accessionNumber,
        payloadJson: JSON.stringify(event.payloadJson),
        filedAt: event.filedAt,
        detectedAt: event.detectedAt,
        dispatchStatus: "new",
        kind: event.kind ?? null,
        payloadV2: event.payloadV2 ? JSON.stringify(event.payloadV2) : null,
        dedupeKey: event.dedupeKey ?? null,
        ttl: event.ttl ?? null,
        occurredAt: event.occurredAt ?? null,
        originKind: v2.originKind,
        originId: v2.originId,
        scheduleGroupKey: v2.scheduleGroupKey,
      })
      .run();
  }

  existsBySourceAndAccession(
    sourceId: string,
    accessionNumber: string,
  ): boolean {
    const row = this.db.db
      .select({ id: signalEvents.id })
      .from(signalEvents)
      .where(
        and(
          eq(signalEvents.sourceId, sourceId),
          eq(signalEvents.accessionNumber, accessionNumber),
        ),
      )
      .get();
    return Boolean(row);
  }

  existsBySourceAndDedupeKey(sourceId: string, dedupeKey: string): boolean {
    const row = this.db.db
      .select({ id: signalEvents.id })
      .from(signalEvents)
      .where(
        and(
          eq(signalEvents.sourceId, sourceId),
          eq(signalEvents.dedupeKey, dedupeKey),
        ),
      )
      .get();
    return Boolean(row);
  }

  /** Dedupe check for scheduled-scan events (null sourceId); matches by scheduleGroupKey + dedupeKey. */
  existsByGroupAndDedupeKey(
    scheduleGroupKey: string,
    dedupeKey: string,
  ): boolean {
    const row = this.db.db
      .select({ id: signalEvents.id })
      .from(signalEvents)
      .where(
        and(
          isNull(signalEvents.sourceId),
          eq(signalEvents.scheduleGroupKey, scheduleGroupKey),
          eq(signalEvents.dedupeKey, dedupeKey),
        ),
      )
      .get();
    return Boolean(row);
  }

  markDispatchStatus(
    id: string,
    status: "fanned_out" | "dropped_pre_fanout",
    sourceDroppedReason?: string,
  ): void {
    this.db.db
      .update(signalEvents)
      .set({
        dispatchStatus: status,
        dispatchCompletedAt: new Date().toISOString(),
        sourceDroppedReason: sourceDroppedReason ?? null,
      })
      .where(eq(signalEvents.id, id))
      .run();
  }

  listRecent(limit = 100): Array<typeof signalEvents.$inferSelect> {
    return this.db.db
      .select()
      .from(signalEvents)
      .orderBy(desc(signalEvents.detectedAt))
      .limit(limit)
      .all();
  }

  listByDispatchStatus(
    status: "new" | "fanned_out" | "dropped_pre_fanout",
  ): Array<typeof signalEvents.$inferSelect> {
    return this.db.db
      .select()
      .from(signalEvents)
      .where(eq(signalEvents.dispatchStatus, status))
      .orderBy(desc(signalEvents.detectedAt))
      .all();
  }

  getById(id: string): SignalEvent | null {
    const row =
      this.db.db
        .select()
        .from(signalEvents)
        .where(eq(signalEvents.id, id))
        .get() ?? null;
    if (!row) return null;
    return {
      id: row.id,
      sourceId: row.sourceId ?? "",
      sourceType: row.sourceType as SignalEvent["sourceType"],
      ticker: row.ticker,
      companyName: row.companyName,
      documentUrl: row.documentUrl,
      accessionNumber: row.accessionNumber,
      payloadJson: JSON.parse(row.payloadJson) as Record<string, unknown>,
      filedAt: row.filedAt,
      detectedAt: row.detectedAt,
      kind: row.kind,
      payloadV2: row.payloadV2
        ? (JSON.parse(row.payloadV2) as Record<string, unknown>)
        : null,
      dedupeKey: row.dedupeKey,
      ttl: row.ttl,
      occurredAt: row.occurredAt,
    };
  }
}
