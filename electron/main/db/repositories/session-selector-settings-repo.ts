import type { DbClient } from "../client";
import type { SessionSelectorSettings } from "@/lib/types";
import { AppError } from "@electron/shared/errors";
import { toSessionSelectorSettings } from "./mappers";

export class SessionSelectorSettingsRepo {
  constructor(private readonly client: DbClient) {}

  get(sessionId: string): SessionSelectorSettings {
    const row = this.client.sqlite
      .prepare("SELECT * FROM session_selector_settings WHERE session_id = ?")
      .get(sessionId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new AppError(`Selector settings for session ${sessionId} were not found`, "NOT_FOUND", { sessionId });
    }
    return toSessionSelectorSettings(row);
  }

  update(sessionId: string, patch: { aiPickerEnabled: boolean }): SessionSelectorSettings {
    this.client.sqlite
      .prepare(
        `
        UPDATE session_selector_settings
        SET ai_picker_enabled = ?, updated_at = ?
        WHERE session_id = ?
        `,
      )
      .run(patch.aiPickerEnabled ? 1 : 0, new Date().toISOString(), sessionId);
    return this.get(sessionId);
  }
}
