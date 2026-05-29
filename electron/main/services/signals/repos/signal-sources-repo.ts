import type { DbClient } from "../../../db/client";
import {
  sessionSignalSources,
  sessions,
  signalSources,
} from "../../../db/schema";
import { and, count, eq } from "drizzle-orm";
import type {
  SignalSourceRecord,
  SignalSourceType,
} from "@electron/shared/domain";

export class SignalSourcesRepo {
  constructor(private readonly db: DbClient) {}

  list(): SignalSourceRecord[] {
    return this.db.db
      .select()
      .from(signalSources)
      .all()
      .map((row) => ({ ...row, type: row.type as SignalSourceType }));
  }

  get(id: string): SignalSourceRecord | null {
    const row =
      this.db.db
        .select()
        .from(signalSources)
        .where(eq(signalSources.id, id))
        .get() ?? null;
    return row ? { ...row, type: row.type as SignalSourceType } : null;
  }

  create(
    input: Omit<SignalSourceRecord, "createdAt" | "updatedAt">,
  ): SignalSourceRecord {
    const now = new Date().toISOString();
    this.db.db
      .insert(signalSources)
      .values({
        ...input,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const created = this.get(input.id);
    if (!created) throw new Error(`Signal source ${input.id} was not created.`);
    return created;
  }

  update(
    id: string,
    patch: Partial<{
      type: SignalSourceType;
      name: string;
      description: string | null;
      enabled: boolean;
      configJson: string;
    }>,
  ): SignalSourceRecord {
    this.db.db
      .update(signalSources)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(eq(signalSources.id, id))
      .run();
    const updated = this.get(id);
    if (!updated)
      throw new Error(`Signal source ${id} was not found after update.`);
    return updated;
  }

  delete(id: string): void {
    this.db.db.delete(signalSources).where(eq(signalSources.id, id)).run();
  }

  setEnabled(id: string, enabled: boolean): void {
    this.update(id, { enabled });
  }

  attachedSessionCount(sourceId: string): number {
    const row = this.db.db
      .select({ count: count() })
      .from(sessionSignalSources)
      .where(eq(sessionSignalSources.sourceId, sourceId))
      .get();
    return Number(row?.count ?? 0);
  }

  attachedSessionNames(sourceId: string): string[] {
    const rows = this.db.db
      .select({ name: sessions.name })
      .from(sessionSignalSources)
      .innerJoin(sessions, eq(sessionSignalSources.sessionId, sessions.id))
      .where(eq(sessionSignalSources.sourceId, sourceId))
      .all();
    return rows.map((row) => row.name);
  }

  subscribedSessionsForSource(sourceId: string): string[] {
    const rows = this.db.db
      .select({
        sessionId: sessionSignalSources.sessionId,
      })
      .from(sessionSignalSources)
      .innerJoin(
        signalSources,
        eq(sessionSignalSources.sourceId, signalSources.id),
      )
      .where(
        and(
          eq(sessionSignalSources.sourceId, sourceId),
          eq(signalSources.enabled, true),
        ),
      )
      .all();
    return rows.map((row) => row.sessionId);
  }

  subscribedSourceStatesForSession(
    sessionId: string,
  ): Array<{ sourceId: string; enabled: boolean }> {
    const rows = this.db.db
      .select({
        sourceId: sessionSignalSources.sourceId,
        enabled: signalSources.enabled,
      })
      .from(sessionSignalSources)
      .innerJoin(
        signalSources,
        eq(sessionSignalSources.sourceId, signalSources.id),
      )
      .where(eq(sessionSignalSources.sessionId, sessionId))
      .all();
    return rows.map((row) => ({
      sourceId: row.sourceId,
      enabled: row.enabled,
    }));
  }

  subscribedSourceIdsForSession(sessionId: string): string[] {
    const rows = this.db.db
      .select({ sourceId: sessionSignalSources.sourceId })
      .from(sessionSignalSources)
      .where(eq(sessionSignalSources.sessionId, sessionId))
      .all();
    return rows.map((row) => row.sourceId);
  }

  replaceSessionSubscriptions(sessionId: string, sourceIds: string[]): void {
    const uniqueIds = [...new Set(sourceIds)];
    this.db.db.transaction((tx) => {
      tx.delete(sessionSignalSources)
        .where(eq(sessionSignalSources.sessionId, sessionId))
        .run();
      for (const sourceId of uniqueIds) {
        tx.insert(sessionSignalSources).values({ sessionId, sourceId }).run();
      }
    });
  }
}
