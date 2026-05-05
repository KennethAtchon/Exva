import type { DbClient } from "../client";
import type { SessionStrategyProfile } from "@/lib/types";
import { AppError } from "@electron/shared/errors";
import { toSessionStrategyProfile } from "./mappers";

export class SessionStrategyProfileRepo {
  constructor(private readonly client: DbClient) {}

  get(sessionId: string): SessionStrategyProfile {
    const row = this.client.sqlite
      .prepare("SELECT * FROM session_strategy_profile WHERE session_id = ?")
      .get(sessionId) as Record<string, unknown> | undefined;
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

    this.client.sqlite
      .prepare(
        `
        UPDATE session_strategy_profile SET
          strategy_type = @strategy_type,
          side_bias = @side_bias,
          entry_style = @entry_style,
          exit_style = @exit_style,
          scaling_mode = @scaling_mode,
          strategy_brief_markdown = @strategy_brief_markdown,
          custom_instructions = @custom_instructions,
          updated_at = @updated_at
        WHERE session_id = @session_id
        `,
      )
      .run({
        session_id: sessionId,
        strategy_type: next.strategyType,
        side_bias: next.sideBias,
        entry_style: next.entryStyle,
        exit_style: next.exitStyle,
        scaling_mode: next.scalingMode,
        strategy_brief_markdown: next.strategyBriefMarkdown,
        custom_instructions: next.customInstructions,
        updated_at: next.updatedAt,
      });

    return this.get(sessionId);
  }
}
