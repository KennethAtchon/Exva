import { eq, and, inArray } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import { sessionInputSubscriptions } from "../../db/schema";

/**
 * Resolves subscription IDs and event-source definition IDs to the
 * `{sessionId, subscriptionId}` pairs that should receive a given signal.
 *
 * Used by the V2 signal pipeline to perform fanout without going through the
 * legacy `session_signal_sources` join path.
 */
export class SubscriptionFanoutResolver {
  constructor(private readonly db: DbClient) {}

  /**
   * Given a source definition ID, find all enabled subscriptions that
   * reference it and return `{sessionId, subscriptionId, templateId,
   * templateVersion}` for each.
   */
  resolveEventFanout(sourceDefinitionId: string): Array<{
    sessionId: string;
    subscriptionId: string;
    templateId: string;
    templateVersion: number;
  }> {
    const rows = this.db.db
      .select({
        id: sessionInputSubscriptions.id,
        sessionId: sessionInputSubscriptions.sessionId,
        templateId: sessionInputSubscriptions.templateId,
        templateVersion: sessionInputSubscriptions.templateVersion,
      })
      .from(sessionInputSubscriptions)
      .where(
        and(
          eq(sessionInputSubscriptions.mode, "event_source"),
          eq(sessionInputSubscriptions.enabled, true),
          eq(
            sessionInputSubscriptions.sourceDefinitionId,
            sourceDefinitionId,
          ),
        ),
      )
      .all();

    return rows.map((row) => ({
      sessionId: row.sessionId,
      subscriptionId: row.id,
      templateId: row.templateId,
      templateVersion: row.templateVersion,
    }));
  }

  /**
   * Given a list of subscription IDs (from a `ScheduledRuntimePlan`), return
   * `{sessionId, subscriptionId}` for each that is still enabled.
   *
   * Disabled or deleted subscriptions are silently excluded.
   */
  resolveScheduledFanout(subscriptionIds: string[]): Array<{
    sessionId: string;
    subscriptionId: string;
  }> {
    if (subscriptionIds.length === 0) return [];

    const rows = this.db.db
      .select({
        id: sessionInputSubscriptions.id,
        sessionId: sessionInputSubscriptions.sessionId,
      })
      .from(sessionInputSubscriptions)
      .where(
        and(
          eq(sessionInputSubscriptions.enabled, true),
          inArray(sessionInputSubscriptions.id, subscriptionIds),
        ),
      )
      .all();

    return rows.map((row) => ({
      sessionId: row.sessionId,
      subscriptionId: row.id,
    }));
  }
}
