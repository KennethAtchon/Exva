import type { DbClient } from "../client";
import { asc, eq, sql } from "drizzle-orm";
import { sessionBrokerAssignments } from "../schema";

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

  countBySession(sessionId: string): number {
    const row = this.client.db
      .select({ count: sql<number>`count(*)` })
      .from(sessionBrokerAssignments)
      .where(eq(sessionBrokerAssignments.sessionId, sessionId))
      .get();
    return Number(row?.count ?? 0);
  }

  replaceAssignments(sessionId: string, brokerAccountIds: string[]): void {
    this.client.db.transaction((tx) => {
      tx.delete(sessionBrokerAssignments).where(eq(sessionBrokerAssignments.sessionId, sessionId)).run();
      for (const brokerAccountId of brokerAccountIds) {
        tx.insert(sessionBrokerAssignments).values({ sessionId, brokerAccountId }).run();
      }
    });
  }
}
