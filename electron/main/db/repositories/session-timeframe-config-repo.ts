import type { DbClient } from "../client";
import type { SessionTimeframeConfig } from "@/lib/types";
import { eq } from "drizzle-orm";
import { AppError } from "@electron/shared/errors";
import { sessionTimeframeConfig } from "../schema";
import { toSessionTimeframeConfig } from "./mappers";

export class SessionTimeframeConfigRepo {
  constructor(private readonly client: DbClient) {}

  get(sessionId: string): SessionTimeframeConfig {
    const row = this.client.db.select().from(sessionTimeframeConfig).where(eq(sessionTimeframeConfig.sessionId, sessionId)).get();
    if (!row) {
      throw new AppError(`Timeframe config for session ${sessionId} was not found`, "NOT_FOUND", { sessionId });
    }
    return toSessionTimeframeConfig(row);
  }

  upsert(sessionId: string, patch: Partial<SessionTimeframeConfig>): SessionTimeframeConfig {
    const current = this.get(sessionId);
    const next: SessionTimeframeConfig = {
      ...current,
      ...patch,
      sessionId,
      updatedAt: new Date().toISOString(),
    };

    this.client.db
      .update(sessionTimeframeConfig)
      .set({
        timeframePresetId: next.timeframePresetId,
        primaryTradingTimeframe: next.primaryTradingTimeframe,
        holdingStyle: next.holdingStyle,
        targetHoldDays: next.targetHoldDays,
        maxHoldDays: next.maxHoldDays,
        timeframeNotes: next.timeframeNotes,
        updatedAt: next.updatedAt,
      })
      .where(eq(sessionTimeframeConfig.sessionId, sessionId))
      .run();

    return this.get(sessionId);
  }
}
