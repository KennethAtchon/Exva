import type { DbClient } from "../client";

export class SessionBrokerAssignmentsRepo {
  constructor(private readonly client: DbClient) {}

  listBrokerAccountIds(sessionId: string): string[] {
    const rows = this.client.sqlite
      .prepare("SELECT broker_account_id FROM session_broker_assignments WHERE session_id = ? ORDER BY broker_account_id ASC")
      .all(sessionId) as Array<{ broker_account_id: string }>;
    return rows.map((row) => row.broker_account_id);
  }

  countBySession(sessionId: string): number {
    const row = this.client.sqlite
      .prepare("SELECT COUNT(*) AS count FROM session_broker_assignments WHERE session_id = ?")
      .get(sessionId) as { count?: number };
    return Number(row.count ?? 0);
  }

  replaceAssignments(sessionId: string, brokerAccountIds: string[]): void {
    const insertStmt = this.client.sqlite.prepare(
      "INSERT INTO session_broker_assignments (session_id, broker_account_id) VALUES (?, ?)",
    );

    this.client.sqlite.transaction(() => {
      this.client.sqlite.prepare("DELETE FROM session_broker_assignments WHERE session_id = ?").run(sessionId);
      for (const brokerAccountId of brokerAccountIds) {
        insertStmt.run(sessionId, brokerAccountId);
      }
    })();
  }
}
