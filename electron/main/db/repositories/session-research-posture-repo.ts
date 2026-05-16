import type { DbClient } from "../client";
import type { SessionResearchPosture } from "@/lib/types";
import { eq } from "drizzle-orm";
import { AppError } from "@electron/shared/infra/errors";
import { sessionResearchPosture } from "../schema";
import { toSessionResearchPosture } from "./mappers";

export class SessionResearchPostureRepo {
  constructor(private readonly client: DbClient) {}

  get(sessionId: string): SessionResearchPosture {
    const row = this.client.db.select().from(sessionResearchPosture).where(eq(sessionResearchPosture.sessionId, sessionId)).get();
    if (!row) {
      throw new AppError(`Research posture for session ${sessionId} was not found`, "NOT_FOUND", { sessionId });
    }
    return toSessionResearchPosture(row);
  }

  upsert(sessionId: string, patch: Partial<SessionResearchPosture>): SessionResearchPosture {
    const current = this.get(sessionId);
    const next: SessionResearchPosture = {
      ...current,
      ...patch,
      sessionId,
      updatedAt: new Date().toISOString(),
    };

    this.client.db
      .update(sessionResearchPosture)
      .set({
        posturePresetId: next.posturePresetId,
        discoveryMode: next.discoveryMode,
        evidenceMode: next.evidenceMode,
        catalystMode: next.catalystMode,
        fundamentalStrictness: next.fundamentalStrictness,
        postureNotes: next.postureNotes,
        updatedAt: next.updatedAt,
      })
      .where(eq(sessionResearchPosture.sessionId, sessionId))
      .run();

    return this.get(sessionId);
  }
}
