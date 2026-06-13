import type { DbClient } from "../../../db/client";
import {
  signalDeadLetters,
  signalEvents,
  signalSources,
} from "../../../db/schema";
import { and, desc, eq } from "drizzle-orm";
import type {
  SignalDeadLetter,
  SignalDeadLetterReason,
} from "@electron/shared/domain";

export class SignalDeadLettersRepo {
  constructor(private readonly db: DbClient) {}

  insert(input: {
    sessionId: string;
    signalEventId: string;
    sourceId: string;
    sourceType: SignalDeadLetter["sourceType"];
    ticker: string;
    instrumentClass: SignalDeadLetter["instrumentClass"];
    reason: SignalDeadLetterReason;
    detail: Record<string, unknown>;
  }): SignalDeadLetter {
    const row: SignalDeadLetter = {
      id: crypto.randomUUID(),
      sessionId: input.sessionId,
      signalEventId: input.signalEventId,
      sourceId: input.sourceId,
      sourceType: input.sourceType,
      ticker: input.ticker,
      instrumentClass: input.instrumentClass,
      reason: input.reason,
      detailJson: JSON.stringify(input.detail),
      createdAt: new Date().toISOString(),
      replayedAt: null,
      resolvedDeliveryId: null,
    };
    this.db.db.insert(signalDeadLetters).values(row).run();
    return row;
  }

  getById(id: string): SignalDeadLetter | null {
    const row =
      this.db.db
        .select()
        .from(signalDeadLetters)
        .where(eq(signalDeadLetters.id, id))
        .get() ?? null;
    return row ? (row as SignalDeadLetter) : null;
  }

  markReplayed(
    id: string,
    resolvedDeliveryId: string,
  ): SignalDeadLetter | null {
    const replayedAt = new Date().toISOString();
    this.db.db
      .update(signalDeadLetters)
      .set({ replayedAt, resolvedDeliveryId })
      .where(eq(signalDeadLetters.id, id))
      .run();
    return this.getById(id);
  }

  listBySessionFiltered(input: {
    sessionId: string;
    reason?: SignalDeadLetterReason;
    limit?: number;
  }): Array<{
    deadLetter: SignalDeadLetter;
    event: typeof signalEvents.$inferSelect;
    source: typeof signalSources.$inferSelect;
  }> {
    const clauses = [eq(signalDeadLetters.sessionId, input.sessionId)];
    if (input.reason) {
      clauses.push(eq(signalDeadLetters.reason, input.reason));
    }
    const rows = this.db.db
      .select()
      .from(signalDeadLetters)
      .innerJoin(
        signalEvents,
        eq(signalDeadLetters.signalEventId, signalEvents.id),
      )
      .innerJoin(
        signalSources,
        eq(signalDeadLetters.sourceId, signalSources.id),
      )
      .where(and(...clauses))
      .orderBy(desc(signalDeadLetters.createdAt))
      .limit(input.limit ?? 50)
      .all();
    return rows.map((row) => ({
      deadLetter: row.signal_dead_letters as SignalDeadLetter,
      event: row.signal_events,
      source: row.signal_sources,
    }));
  }
}
