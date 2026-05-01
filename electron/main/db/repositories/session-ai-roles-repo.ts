import type { DbClient } from "../client";
import type { AgentRole, SessionAiRole } from "@/lib/types";
import { toSessionAiRole } from "./mappers";

export class SessionAiRolesRepo {
  constructor(private readonly client: DbClient) {}

  listBySession(sessionId: string): SessionAiRole[] {
    const rows = this.client.sqlite
      .prepare("SELECT * FROM session_ai_roles WHERE session_id = ? ORDER BY role ASC")
      .all(sessionId) as Record<string, unknown>[];
    return rows.map(toSessionAiRole);
  }

  getByRole(sessionId: string, role: AgentRole): SessionAiRole | null {
    const row = this.client.sqlite
      .prepare("SELECT * FROM session_ai_roles WHERE session_id = ? AND role = ?")
      .get(sessionId, role) as Record<string, unknown> | undefined;
    return row ? toSessionAiRole(row) : null;
  }
}
