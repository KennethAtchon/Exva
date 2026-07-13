import { eq } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import { sessionInputSubscriptions, sessions } from "../../db/schema";
import type {
  SessionInputSubscription,
  SessionInputSubscriptionDraft,
  SessionInputConfiguration,
} from "@electron/shared/domain/experience-inputs/subscription";
import type { TradingTimeframe } from "@electron/shared/domain/enums";
import { serializeCadenceCanonical } from "@electron/shared/domain/experience-inputs/cadence";

export class SessionInputSubscriptionRepo {
  constructor(private readonly db: DbClient) {}

  get(id: string): SessionInputSubscription | null {
    const row = this.db.db
      .select()
      .from(sessionInputSubscriptions)
      .where(eq(sessionInputSubscriptions.id, id))
      .get();
    return row ? rowToSubscription(row) : null;
  }

  listBySession(sessionId: string): SessionInputSubscription[] {
    return this.db.db
      .select()
      .from(sessionInputSubscriptions)
      .where(eq(sessionInputSubscriptions.sessionId, sessionId))
      .all()
      .map(rowToSubscription);
  }

  listEnabledBySession(sessionId: string): SessionInputSubscription[] {
    return this.listBySession(sessionId).filter((s) => s.enabled);
  }

  listBySourceDefinition(sourceDefinitionId: string): SessionInputSubscription[] {
    return this.db.db
      .select()
      .from(sessionInputSubscriptions)
      .where(eq(sessionInputSubscriptions.sourceDefinitionId, sourceDefinitionId))
      .all()
      .map(rowToSubscription);
  }

  listByInstrumentSet(instrumentSetId: string): SessionInputSubscription[] {
    return this.db.db
      .select()
      .from(sessionInputSubscriptions)
      .where(eq(sessionInputSubscriptions.instrumentSetId, instrumentSetId))
      .all()
      .map(rowToSubscription);
  }

  getConfiguration(sessionId: string): SessionInputConfiguration {
    const session = this.db.db
      .select({
        id: sessions.id,
        sessionInputRevision: sessions.sessionInputRevision,
      })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .get();

    return {
      sessionId,
      inputRevision: session?.sessionInputRevision ?? 0,
      subscriptions: this.listBySession(sessionId),
    };
  }

  create(
    sessionId: string,
    draft: SessionInputSubscriptionDraft,
  ): SessionInputSubscription {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const base = {
      id,
      sessionId,
      templateId: draft.templateId,
      templateVersion: draft.templateVersion,
      mode: draft.mode,
      enabled: true,
      createdFromProfileId: draft.createdFromProfileId ?? null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    };

    if (draft.mode === "event_source") {
      this.db.db
        .insert(sessionInputSubscriptions)
        .values({
          ...base,
          sourceDefinitionId: draft.sourceDefinitionId,
          sourceRevision: draft.sourceRevision,
          analysisTimeframe: draft.analysisTimeframe,
          filtersJson: JSON.stringify(draft.filters),
          usesUnvalidatedUniverse: false,
        })
        .run();
    } else {
      this.db.db
        .insert(sessionInputSubscriptions)
        .values({
          ...base,
          instrumentSetId: draft.instrumentSetId,
          instrumentSetRevision: draft.instrumentSetRevision,
          cadenceJson: serializeCadenceCanonical(draft.cadence),
          analysisTimeframe: draft.analysisTimeframe,
          marketCalendarId: draft.marketCalendarId,
          strategyParametersJson: JSON.stringify(draft.strategyParameters),
          usesUnvalidatedUniverse: false,
        })
        .run();
    }

    const saved = this.get(id);
    if (!saved) {
      throw new Error(
        `SessionInputSubscriptionRepo: subscription ${id} not found after insert`,
      );
    }
    return saved;
  }

  setEnabled(id: string, enabled: boolean): void {
    const now = new Date().toISOString();
    this.db.db
      .update(sessionInputSubscriptions)
      .set({ enabled, updatedAt: now })
      .where(eq(sessionInputSubscriptions.id, id))
      .run();
  }

  setUsesUnvalidatedUniverse(id: string, flag: boolean): void {
    const now = new Date().toISOString();
    this.db.db
      .update(sessionInputSubscriptions)
      .set({ usesUnvalidatedUniverse: flag, updatedAt: now })
      .where(eq(sessionInputSubscriptions.id, id))
      .run();
  }

  delete(id: string): void {
    this.db.db
      .delete(sessionInputSubscriptions)
      .where(eq(sessionInputSubscriptions.id, id))
      .run();
  }

  /**
   * Atomically replace all subscriptions for a session and bump the session
   * input revision. Returns the resulting configuration.
   */
  replaceSessionSubscriptions(
    sessionId: string,
    drafts: SessionInputSubscriptionDraft[],
    expectedRevision: number,
  ): SessionInputConfiguration {
    return this.db.db.transaction((tx) => {
      const session = tx
        .select({ sessionInputRevision: sessions.sessionInputRevision })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .get();

      const currentRevision = session?.sessionInputRevision ?? 0;
      if (currentRevision !== expectedRevision) {
        throw new Error(
          `Optimistic concurrency conflict: expected revision ${expectedRevision}, got ${currentRevision}`,
        );
      }

      tx.delete(sessionInputSubscriptions)
        .where(eq(sessionInputSubscriptions.sessionId, sessionId))
        .run();

      const now = new Date().toISOString();
      const nextRevision = currentRevision + 1;

      for (const draft of drafts) {
        const id = crypto.randomUUID();
        const base = {
          id,
          sessionId,
          templateId: draft.templateId,
          templateVersion: draft.templateVersion,
          mode: draft.mode,
          enabled: true,
          createdFromProfileId: draft.createdFromProfileId ?? null,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        };

        if (draft.mode === "event_source") {
          tx.insert(sessionInputSubscriptions)
            .values({
              ...base,
              sourceDefinitionId: draft.sourceDefinitionId,
              sourceRevision: draft.sourceRevision,
              analysisTimeframe: draft.analysisTimeframe,
              filtersJson: JSON.stringify(draft.filters),
              usesUnvalidatedUniverse: false,
            })
            .run();
        } else {
          tx.insert(sessionInputSubscriptions)
            .values({
              ...base,
              instrumentSetId: draft.instrumentSetId,
              instrumentSetRevision: draft.instrumentSetRevision,
              cadenceJson: serializeCadenceCanonical(draft.cadence),
              analysisTimeframe: draft.analysisTimeframe,
              marketCalendarId: draft.marketCalendarId,
              strategyParametersJson: JSON.stringify(draft.strategyParameters),
              usesUnvalidatedUniverse: false,
            })
            .run();
        }
      }

      tx.update(sessions)
        .set({ sessionInputRevision: nextRevision, updatedAt: now })
        .where(eq(sessions.id, sessionId))
        .run();

      const subs = tx
        .select()
        .from(sessionInputSubscriptions)
        .where(eq(sessionInputSubscriptions.sessionId, sessionId))
        .all()
        .map(rowToSubscription);

      return { sessionId, inputRevision: nextRevision, subscriptions: subs };
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SubRow = typeof sessionInputSubscriptions.$inferSelect;

function rowToSubscription(row: SubRow): SessionInputSubscription {
  const base = {
    id: row.id,
    sessionId: row.sessionId,
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    enabled: row.enabled,
    createdFromProfileId: row.createdFromProfileId,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };

  if (row.mode === "event_source") {
    return {
      ...base,
      mode: "event_source",
      sourceDefinitionId: row.sourceDefinitionId!,
      sourceRevision: row.sourceRevision!,
      filtersJson: row.filtersJson ?? "{}",
      analysisTimeframe: row.analysisTimeframe as TradingTimeframe,
    };
  }

  return {
    ...base,
    mode: "scheduled_scan",
    instrumentSetId: row.instrumentSetId!,
    instrumentSetRevision: row.instrumentSetRevision!,
    cadenceJson: row.cadenceJson!,
    analysisTimeframe: row.analysisTimeframe as TradingTimeframe,
    marketCalendarId: row.marketCalendarId!,
    strategyParametersJson: row.strategyParametersJson ?? "{}",
  };
}
