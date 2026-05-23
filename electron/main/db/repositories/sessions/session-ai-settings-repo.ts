import type { DbClient } from "../../client";
import type { SessionAiSettings } from "@/lib/types";
import { eq } from "drizzle-orm";
import { AppError } from "@electron/shared/infra/errors";
import { sessionAiSettings } from "../../schema";
import { toSessionAiSettings } from "../system/mappers";

export class SessionAiSettingsRepo {
  constructor(private readonly client: DbClient) {}

  get(sessionId: string): SessionAiSettings {
    const row = this.client.db
      .select()
      .from(sessionAiSettings)
      .where(eq(sessionAiSettings.sessionId, sessionId))
      .get();
    if (!row) {
      throw new AppError(
        `AI settings for session ${sessionId} were not found`,
        "NOT_FOUND",
        { sessionId },
      );
    }
    return toSessionAiSettings(row);
  }

  upsert(
    sessionId: string,
    patch: Partial<SessionAiSettings>,
  ): SessionAiSettings {
    const current = this.get(sessionId);
    const next: SessionAiSettings = {
      ...current,
      ...patch,
      sessionId,
      updatedAt: new Date().toISOString(),
    };

    this.client.db
      .update(sessionAiSettings)
      .set({
        workerGuidanceMarkdown: next.workerGuidanceMarkdown,
        updatedAt: next.updatedAt,
      })
      .where(eq(sessionAiSettings.sessionId, sessionId))
      .run();

    return this.get(sessionId);
  }
}
