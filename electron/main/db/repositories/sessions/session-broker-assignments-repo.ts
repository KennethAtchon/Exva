import type { DbClient } from "../../client";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { sessionBrokerAssignments, sessions } from "../../schema";

export class SessionBrokerAssignmentsRepo {
  constructor(private readonly client: DbClient) {}

  listBrokerAccountIds(sessionId: string): string[] {
    const rows = this.client.db
      .select({ brokerAccountId: sessionBrokerAssignments.brokerAccountId })
      .from(sessionBrokerAssignments)
      .where(eq(sessionBrokerAssignments.sessionId, sessionId))
      .orderBy(asc(sessionBrokerAssignments.brokerAccountId))
      .all();
    return rows.map((row) => row.brokerAccountId);
  }

  listAssignments(sessionId: string): Array<{ brokerAccountId: string; allocatedUsd: number }> {
    return this.client.db
      .select({
        brokerAccountId: sessionBrokerAssignments.brokerAccountId,
        allocatedUsd: sessionBrokerAssignments.allocatedUsd,
      })
      .from(sessionBrokerAssignments)
      .where(eq(sessionBrokerAssignments.sessionId, sessionId))
      .orderBy(asc(sessionBrokerAssignments.brokerAccountId))
      .all()
      .map((row) => ({
        brokerAccountId: row.brokerAccountId,
        allocatedUsd: Number(row.allocatedUsd ?? 0),
      }));
  }

  listAssignmentsForBroker(brokerAccountId: string): Array<{ sessionId: string; allocatedUsd: number }> {
    return this.client.db
      .select({
        sessionId: sessionBrokerAssignments.sessionId,
        allocatedUsd: sessionBrokerAssignments.allocatedUsd,
      })
      .from(sessionBrokerAssignments)
      .where(eq(sessionBrokerAssignments.brokerAccountId, brokerAccountId))
      .orderBy(asc(sessionBrokerAssignments.sessionId))
      .all()
      .map((row) => ({ sessionId: row.sessionId, allocatedUsd: Number(row.allocatedUsd ?? 0) }));
  }

  listAll(): Array<{ sessionId: string; brokerAccountId: string; allocatedUsd: number }> {
    return this.client.db
      .select({
        sessionId: sessionBrokerAssignments.sessionId,
        brokerAccountId: sessionBrokerAssignments.brokerAccountId,
        allocatedUsd: sessionBrokerAssignments.allocatedUsd,
      })
      .from(sessionBrokerAssignments)
      .orderBy(asc(sessionBrokerAssignments.sessionId), asc(sessionBrokerAssignments.brokerAccountId))
      .all()
      .map((row) => ({
        sessionId: row.sessionId,
        brokerAccountId: row.brokerAccountId,
        allocatedUsd: Number(row.allocatedUsd ?? 0),
      }));
  }

  countBySession(sessionId: string): number {
    const row = this.client.db
      .select({ count: sql<number>`count(*)` })
      .from(sessionBrokerAssignments)
      .where(eq(sessionBrokerAssignments.sessionId, sessionId))
      .get();
    return Number(row?.count ?? 0);
  }

  countActiveSessionsForBroker(brokerAccountId: string, activeSessionIds: string[]): number {
    if (activeSessionIds.length === 0) return 0;
    const row = this.client.db
      .select({ count: sql<number>`count(*)` })
      .from(sessionBrokerAssignments)
      .where(
        and(
          eq(sessionBrokerAssignments.brokerAccountId, brokerAccountId),
          inArray(sessionBrokerAssignments.sessionId, activeSessionIds),
        ),
      )
      .get();
    return Number(row?.count ?? 0);
  }

  sumAllocatedUsdForBroker(brokerAccountId: string, activeSessionIds: string[]): number {
    if (activeSessionIds.length === 0) return 0;
    const row = this.client.db
      .select({ total: sql<number>`coalesce(sum(${sessionBrokerAssignments.allocatedUsd}), 0)` })
      .from(sessionBrokerAssignments)
      .where(
        and(
          eq(sessionBrokerAssignments.brokerAccountId, brokerAccountId),
          inArray(sessionBrokerAssignments.sessionId, activeSessionIds),
        ),
      )
      .get();
    return Number(row?.total ?? 0);
  }

  findAssignment(sessionId: string, brokerAccountId: string): { brokerAccountId: string; allocatedUsd: number } | null {
    const row = this.client.db
      .select({
        brokerAccountId: sessionBrokerAssignments.brokerAccountId,
        allocatedUsd: sessionBrokerAssignments.allocatedUsd,
      })
      .from(sessionBrokerAssignments)
      .where(
        and(
          eq(sessionBrokerAssignments.sessionId, sessionId),
          eq(sessionBrokerAssignments.brokerAccountId, brokerAccountId),
        ),
      )
      .get();
    if (!row) return null;
    return { brokerAccountId: row.brokerAccountId, allocatedUsd: Number(row.allocatedUsd ?? 0) };
  }

  setAllocatedUsd(sessionId: string, brokerAccountId: string, allocatedUsd: number): void {
    this.client.db
      .update(sessionBrokerAssignments)
      .set({ allocatedUsd })
      .where(
        and(
          eq(sessionBrokerAssignments.sessionId, sessionId),
          eq(sessionBrokerAssignments.brokerAccountId, brokerAccountId),
        ),
      )
      .run();
  }

  replaceAssignments(sessionId: string, assignments: Array<{ brokerAccountId: string; allocatedUsd: number }>): void {
    this.client.db.transaction((tx) => {
      tx.delete(sessionBrokerAssignments).where(eq(sessionBrokerAssignments.sessionId, sessionId)).run();
      for (const assignment of assignments) {
        tx.insert(sessionBrokerAssignments)
          .values({
            sessionId,
            brokerAccountId: assignment.brokerAccountId,
            allocatedUsd: assignment.allocatedUsd,
          })
          .run();
      }
    });
  }
}
