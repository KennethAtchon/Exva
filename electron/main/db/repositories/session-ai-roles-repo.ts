import type { DbClient } from "../client";
import type { AgentRole, SessionAiRole } from "@/lib/types";
import { and, asc, eq } from "drizzle-orm";
import { AppError } from "@electron/shared/errors";
import { sessionAiRoles } from "../schema";
import { toSessionAiRole } from "./mappers";

export class SessionAiRolesRepo {
  constructor(private readonly client: DbClient) {}

  listBySession(sessionId: string): SessionAiRole[] {
    const rows = this.client.db
      .select()
      .from(sessionAiRoles)
      .where(eq(sessionAiRoles.sessionId, sessionId))
      .orderBy(asc(sessionAiRoles.role))
      .all();
    return rows.map(toSessionAiRole);
  }

  getByRole(sessionId: string, role: AgentRole): SessionAiRole | null {
    const row = this.client.db
      .select()
      .from(sessionAiRoles)
      .where(and(eq(sessionAiRoles.sessionId, sessionId), eq(sessionAiRoles.role, role)))
      .get();
    return row ? toSessionAiRole(row) : null;
  }

  requireByRole(sessionId: string, role: AgentRole): SessionAiRole {
    const aiRole = this.getByRole(sessionId, role);
    if (!aiRole) {
      throw new AppError(`AI role ${role} for session ${sessionId} was not found`, "NOT_FOUND", { sessionId, role });
    }
    return aiRole;
  }

  replaceAll(sessionId: string, aiRoles: SessionAiRole[]): void {
    this.client.db.transaction((tx) => {
      for (const aiRole of aiRoles) {
        tx.update(sessionAiRoles)
          .set({
            providerKey: aiRole.providerKey,
            modelId: aiRole.modelId,
            temperature: aiRole.temperature,
            maxTokens: aiRole.maxTokens,
            promptSource: aiRole.promptSource,
            promptMarkdown: aiRole.promptMarkdown,
            promptAssetPath: aiRole.promptAssetPath,
          })
          .where(and(eq(sessionAiRoles.sessionId, sessionId), eq(sessionAiRoles.role, aiRole.role)))
          .run();
      }
    });
  }
}
