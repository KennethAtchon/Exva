import type { DbClient } from "../client";
import type { AgentRole, SessionAiRoleProfile } from "@/lib/types";
import { and, eq } from "drizzle-orm";
import { AppError } from "@electron/shared/errors";
import { sessionAiRoleProfile } from "../schema";
import { toSessionAiRoleProfile } from "./mappers";

export class SessionAiRoleProfileRepo {
  constructor(private readonly client: DbClient) {}

  list(sessionId: string): SessionAiRoleProfile[] {
    const rows = this.client.db.select().from(sessionAiRoleProfile).where(eq(sessionAiRoleProfile.sessionId, sessionId)).all();
    return rows.map(toSessionAiRoleProfile);
  }

  get(sessionId: string, role: AgentRole): SessionAiRoleProfile {
    const row = this.client.db
      .select()
      .from(sessionAiRoleProfile)
      .where(and(eq(sessionAiRoleProfile.sessionId, sessionId), eq(sessionAiRoleProfile.role, role)))
      .get();
    if (!row) {
      throw new AppError(`AI role profile for session ${sessionId} role ${role} was not found`, "NOT_FOUND", {
        sessionId,
        role,
      });
    }
    return toSessionAiRoleProfile(row);
  }

  upsert(sessionId: string, role: AgentRole, patch: Partial<SessionAiRoleProfile>): SessionAiRoleProfile {
    const current = this.get(sessionId, role);
    const next: SessionAiRoleProfile = {
      ...current,
      ...patch,
      sessionId,
      role,
      updatedAt: new Date().toISOString(),
    };

    this.client.db
      .update(sessionAiRoleProfile)
      .set({
        operatingPresetId: next.operatingPresetId,
        operatingSpecJson: JSON.stringify(next.operatingSpec ?? {}),
        notes: next.notes,
        updatedAt: next.updatedAt,
      })
      .where(and(eq(sessionAiRoleProfile.sessionId, sessionId), eq(sessionAiRoleProfile.role, role)))
      .run();

    return this.get(sessionId, role);
  }
}
