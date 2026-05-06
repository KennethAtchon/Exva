import type { DbClient } from "../client";
import type { SessionSelectorSettings } from "@/lib/types";
import { eq } from "drizzle-orm";
import { AppError } from "@electron/shared/errors";
import { sessionSelectorSettings } from "../schema";
import { toSessionSelectorSettings } from "./mappers";

export class SessionSelectorSettingsRepo {
  constructor(private readonly client: DbClient) {}

  get(sessionId: string): SessionSelectorSettings {
    const row = this.client.db.select().from(sessionSelectorSettings).where(eq(sessionSelectorSettings.sessionId, sessionId)).get();
    if (!row) {
      throw new AppError(`Selector settings for session ${sessionId} were not found`, "NOT_FOUND", { sessionId });
    }
    return toSessionSelectorSettings(row);
  }

  update(sessionId: string, patch: { aiPickerEnabled: boolean }): SessionSelectorSettings {
    this.client.db
      .update(sessionSelectorSettings)
      .set({
        aiPickerEnabled: patch.aiPickerEnabled,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(sessionSelectorSettings.sessionId, sessionId))
      .run();
    return this.get(sessionId);
  }
}
