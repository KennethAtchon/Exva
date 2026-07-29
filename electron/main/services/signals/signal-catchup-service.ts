import { and, eq, gte, sql } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import {
  sessionSignalDeliveries,
  signalEvents,
} from "../../db/schema";
import { createLogger } from "../infra/log";

const logger = createLogger("signal-catchup");

export interface SignalCatchupDeps {
  db: DbClient;
  /**
   * Apply the same delivery gate used for live fan-out.
   * Return true to deliver, false to skip.
   */
  deliveryGate: (input: {
    sessionId: string;
    subscriptionId: string;
    signalEventId: string;
  }) => boolean;
  now?: () => Date;
}

/**
 * Deliver eligible historical source events to newly ready subscriptions
 * (Solution 02 WS5). Source-level dedupe stays global; delivery idempotency
 * is (subscription_id, signal_event_id).
 */
export class SignalCatchupService {
  constructor(private readonly deps: SignalCatchupDeps) {}

  async catchUp(input: {
    sessionId: string;
    subscriptionId: string;
    sourceId: string | null;
    /** ISO cursor: deliver events with detectedAt > cursor. */
    catchupFrom: string;
    ttlBoundaryIso: string;
  }): Promise<{ delivered: number; skipped: number }> {
    const now = (this.deps.now ?? (() => new Date))().toISOString();
    const fromTs =
      input.catchupFrom > input.ttlBoundaryIso
        ? input.catchupFrom
        : input.ttlBoundaryIso;

    const events = this.deps.db.db
      .select()
      .from(signalEvents)
      .where(
        and(
          input.sourceId
            ? eq(signalEvents.sourceId, input.sourceId)
            : sql`${signalEvents.sourceId} is not null`,
          gte(signalEvents.detectedAt, fromTs),
        ),
      )
      .all();

    let delivered = 0;
    let skipped = 0;

    for (const event of events) {
      const existing = this.deps.db.db
        .select()
        .from(sessionSignalDeliveries)
        .where(
          and(
            eq(sessionSignalDeliveries.subscriptionId, input.subscriptionId),
            eq(sessionSignalDeliveries.signalEventId, event.id),
          ),
        )
        .get();
      if (existing) {
        skipped += 1;
        continue;
      }

      const allowed = this.deps.deliveryGate({
        sessionId: input.sessionId,
        subscriptionId: input.subscriptionId,
        signalEventId: event.id,
      });
      if (!allowed) {
        skipped += 1;
        continue;
      }

      this.deps.db.db
        .insert(sessionSignalDeliveries)
        .values({
          id: crypto.randomUUID(),
          sessionId: input.sessionId,
          signalEventId: event.id,
          sourceId: event.sourceId,
          queuePositionAtEnqueue: 0,
          status: "queued",
          statusBucket: "queued",
          enqueuedAt: now,
          subscriptionId: input.subscriptionId,
        })
        .run();
      delivered += 1;
    }

    logger.info(
      {
        sessionId: input.sessionId,
        subscriptionId: input.subscriptionId,
        delivered,
        skipped,
        fromTs,
      },
      "signal catch-up complete",
    );
    return { delivered, skipped };
  }
}
