import type { DbClient } from "../client";
import type { SessionTimeframeConfig } from "@/lib/types";
import { AppError } from "@electron/shared/errors";
import { toSessionTimeframeConfig } from "./mappers";

export class SessionTimeframeConfigRepo {
  constructor(private readonly client: DbClient) {}

  get(sessionId: string): SessionTimeframeConfig {
    const row = this.client.sqlite
      .prepare("SELECT * FROM session_timeframe_config WHERE session_id = ?")
      .get(sessionId) as Record<string, unknown> | undefined;
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

    this.client.sqlite
      .prepare(
        `
        UPDATE session_timeframe_config SET
          primary_trading_timeframe = @primary_trading_timeframe,
          holding_style = @holding_style,
          target_hold_days = @target_hold_days,
          max_hold_days = @max_hold_days,
          timeframe_notes = @timeframe_notes,
          updated_at = @updated_at
        WHERE session_id = @session_id
        `,
      )
      .run({
        session_id: sessionId,
        primary_trading_timeframe: next.primaryTradingTimeframe,
        holding_style: next.holdingStyle,
        target_hold_days: next.targetHoldDays,
        max_hold_days: next.maxHoldDays,
        timeframe_notes: next.timeframeNotes,
        updated_at: next.updatedAt,
      });

    return this.get(sessionId);
  }
}
