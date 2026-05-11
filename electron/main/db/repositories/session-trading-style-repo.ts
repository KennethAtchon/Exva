import type { DbClient } from "../client";
import type { SessionTradingStyle } from "@/lib/types";
import { eq } from "drizzle-orm";
import { AppError } from "@electron/shared/errors";
import { sessionTradingStyle } from "../schema";
import { toSessionTradingStyle } from "./mappers";

export class SessionTradingStyleRepo {
  constructor(private readonly client: DbClient) {}

  get(sessionId: string): SessionTradingStyle {
    const row = this.client.db.select().from(sessionTradingStyle).where(eq(sessionTradingStyle.sessionId, sessionId)).get();
    if (!row) {
      throw new AppError(`Trading style for session ${sessionId} was not found`, "NOT_FOUND", { sessionId });
    }
    return toSessionTradingStyle(row);
  }

  upsert(sessionId: string, patch: Partial<SessionTradingStyle>): SessionTradingStyle {
    const current = this.get(sessionId);
    const next: SessionTradingStyle = {
      ...current,
      ...patch,
      sessionId,
      updatedAt: new Date().toISOString(),
    };

    this.client.db
      .update(sessionTradingStyle)
      .set({
        stylePresetId: next.stylePresetId,
        discoveryMode: next.discoveryMode,
        evidenceMode: next.evidenceMode,
        catalystMode: next.catalystMode,
        fundamentalStrictness: next.fundamentalStrictness,
        styleNotes: next.styleNotes,
        updatedAt: next.updatedAt,
      })
      .where(eq(sessionTradingStyle.sessionId, sessionId))
      .run();

    return this.get(sessionId);
  }
}
