import type { DbClient } from "../client";
import type { SessionStrategyProfile } from "@/lib/types";
import { eq } from "drizzle-orm";
import { AppError } from "@electron/shared/errors";
import { sessionStrategyProfile } from "../schema";
import { toSessionStrategyProfile } from "./mappers";

export class SessionStrategyProfileRepo {
  constructor(private readonly client: DbClient) {}

  get(sessionId: string): SessionStrategyProfile {
    const row = this.client.db.select().from(sessionStrategyProfile).where(eq(sessionStrategyProfile.sessionId, sessionId)).get();
    if (!row) {
      throw new AppError(`Strategy profile for session ${sessionId} was not found`, "NOT_FOUND", { sessionId });
    }
    return toSessionStrategyProfile(row);
  }

  upsert(sessionId: string, patch: Partial<SessionStrategyProfile>): SessionStrategyProfile {
    const current = this.get(sessionId);
    const next: SessionStrategyProfile = {
      ...current,
      ...patch,
      sessionId,
      updatedAt: new Date().toISOString(),
    };

    this.client.db
      .update(sessionStrategyProfile)
      .set({
        strategyType: next.strategyType,
        sideBias: next.sideBias,
        entryStyle: next.entryStyle,
        exitStyle: next.exitStyle,
        scalingMode: next.scalingMode,
        strategyBriefMarkdown: next.strategyBriefMarkdown,
        customInstructions: next.customInstructions,
        updatedAt: next.updatedAt,
      })
      .where(eq(sessionStrategyProfile.sessionId, sessionId))
      .run();

    return this.get(sessionId);
  }
}
