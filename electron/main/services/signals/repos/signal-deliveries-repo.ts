import type { DbClient } from "../../../db/client";
import {
  sessionSignalDeliveries,
  signalEvents,
  signalSources,
} from "../../../db/schema";
import { and, desc, eq } from "drizzle-orm";
import type { SessionSignalDelivery } from "@electron/shared/domain";

export class SignalDeliveriesRepo {
  constructor(private readonly db: DbClient) {}

  enqueue(input: {
    sessionId: string;
    signalEventId: string;
    sourceId: string;
    queuePositionAtEnqueue: number;
  }): SessionSignalDelivery {
    const row: SessionSignalDelivery = {
      id: crypto.randomUUID(),
      sessionId: input.sessionId,
      signalEventId: input.signalEventId,
      sourceId: input.sourceId,
      queuePositionAtEnqueue: input.queuePositionAtEnqueue,
      status: "queued",
      statusBucket: "pending",
      enqueuedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      expiresAt: null,
      tradeId: null,
      dropReason: null,
      notesJson: null,
    };
    this.db.db.insert(sessionSignalDeliveries).values(row).run();
    return row;
  }

  enqueueWithStatus(input: {
    sessionId: string;
    signalEventId: string;
    sourceId: string;
    queuePositionAtEnqueue: number;
    status: SessionSignalDelivery["status"];
    statusBucket: SessionSignalDelivery["statusBucket"];
    expiresAt?: string | null;
  }): SessionSignalDelivery {
    const row: SessionSignalDelivery = {
      id: crypto.randomUUID(),
      sessionId: input.sessionId,
      signalEventId: input.signalEventId,
      sourceId: input.sourceId,
      queuePositionAtEnqueue: input.queuePositionAtEnqueue,
      status: input.status,
      statusBucket: input.statusBucket,
      enqueuedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      expiresAt: input.expiresAt ?? null,
      tradeId: null,
      dropReason: null,
      notesJson: null,
    };
    this.db.db.insert(sessionSignalDeliveries).values(row).run();
    return row;
  }

  updateStatus(
    deliveryId: string,
    patch: {
      status: SessionSignalDelivery["status"];
      statusBucket: SessionSignalDelivery["statusBucket"];
      startedAt?: string | null;
      finishedAt?: string | null;
      expiresAt?: string | null;
      tradeId?: string | null;
      dropReason?: string | null;
      notesJson?: string | null;
    },
  ): void {
    this.db.db
      .update(sessionSignalDeliveries)
      .set(patch)
      .where(eq(sessionSignalDeliveries.id, deliveryId))
      .run();
  }

  listBySession(sessionId: string): Array<{
    delivery: SessionSignalDelivery;
    event: typeof signalEvents.$inferSelect;
    source: typeof signalSources.$inferSelect;
  }> {
    const rows = this.db.db
      .select()
      .from(sessionSignalDeliveries)
      .innerJoin(
        signalEvents,
        eq(sessionSignalDeliveries.signalEventId, signalEvents.id),
      )
      .innerJoin(
        signalSources,
        eq(sessionSignalDeliveries.sourceId, signalSources.id),
      )
      .where(eq(sessionSignalDeliveries.sessionId, sessionId))
      .orderBy(desc(sessionSignalDeliveries.enqueuedAt))
      .all();
    return rows.map((row) => ({
      delivery: row.session_signal_deliveries as SessionSignalDelivery,
      event: row.signal_events,
      source: row.signal_sources,
    }));
  }

  getDetailedById(deliveryId: string): {
    delivery: SessionSignalDelivery;
    event: typeof signalEvents.$inferSelect;
    source: typeof signalSources.$inferSelect;
  } | null {
    const row =
      this.db.db
        .select()
        .from(sessionSignalDeliveries)
        .innerJoin(
          signalEvents,
          eq(sessionSignalDeliveries.signalEventId, signalEvents.id),
        )
        .innerJoin(
          signalSources,
          eq(sessionSignalDeliveries.sourceId, signalSources.id),
        )
        .where(eq(sessionSignalDeliveries.id, deliveryId))
        .get() ?? null;
    if (!row) return null;
    return {
      delivery: row.session_signal_deliveries as SessionSignalDelivery,
      event: row.signal_events,
      source: row.signal_sources,
    };
  }

  listBySessionFiltered(input: {
    sessionId: string;
    statusBucket?: SessionSignalDelivery["statusBucket"];
    limit?: number;
  }): Array<{
    delivery: SessionSignalDelivery;
    event: typeof signalEvents.$inferSelect;
    source: typeof signalSources.$inferSelect;
  }> {
    const clauses = [eq(sessionSignalDeliveries.sessionId, input.sessionId)];
    if (input.statusBucket) {
      clauses.push(
        eq(sessionSignalDeliveries.statusBucket, input.statusBucket),
      );
    }
    const rows = this.db.db
      .select()
      .from(sessionSignalDeliveries)
      .innerJoin(
        signalEvents,
        eq(sessionSignalDeliveries.signalEventId, signalEvents.id),
      )
      .innerJoin(
        signalSources,
        eq(sessionSignalDeliveries.sourceId, signalSources.id),
      )
      .where(and(...clauses))
      .orderBy(desc(sessionSignalDeliveries.enqueuedAt))
      .limit(input.limit ?? 50)
      .all();
    return rows.map((row) => ({
      delivery: row.session_signal_deliveries as SessionSignalDelivery,
      event: row.signal_events,
      source: row.signal_sources,
    }));
  }

  nextQueuePosition(sessionId: string): number {
    const rows = this.db.db
      .select({
        queuePositionAtEnqueue: sessionSignalDeliveries.queuePositionAtEnqueue,
      })
      .from(sessionSignalDeliveries)
      .where(eq(sessionSignalDeliveries.sessionId, sessionId))
      .orderBy(desc(sessionSignalDeliveries.queuePositionAtEnqueue))
      .limit(1)
      .all();
    return (rows[0]?.queuePositionAtEnqueue ?? -1) + 1;
  }

  listBySessionAndStatus(
    sessionId: string,
    status: SessionSignalDelivery["status"],
  ): SessionSignalDelivery[] {
    return this.db.db
      .select()
      .from(sessionSignalDeliveries)
      .where(
        and(
          eq(sessionSignalDeliveries.sessionId, sessionId),
          eq(sessionSignalDeliveries.status, status),
        ),
      )
      .orderBy(desc(sessionSignalDeliveries.enqueuedAt))
      .all() as SessionSignalDelivery[];
  }

  listByStatus(
    status: SessionSignalDelivery["status"],
  ): SessionSignalDelivery[] {
    return this.db.db
      .select()
      .from(sessionSignalDeliveries)
      .where(eq(sessionSignalDeliveries.status, status))
      .all() as SessionSignalDelivery[];
  }
}
