import type { DbClient } from "../client";
import type { SessionConfig, SessionStrategy } from "@/lib/types";
import { AppError } from "@electron/shared/errors";
import { toSessionConfig, toSessionStrategy } from "./mappers";

export class SessionStrategiesRepo {
  constructor(private readonly client: DbClient) {}

  get(sessionId: string): SessionStrategy {
    const row = this.client.sqlite
      .prepare("SELECT * FROM session_strategies WHERE session_id = ?")
      .get(sessionId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new AppError(`Strategy for session ${sessionId} was not found`, "NOT_FOUND", { sessionId });
    }
    return toSessionStrategy(row);
  }

  getConfig(sessionId: string): SessionConfig {
    const row = this.client.sqlite
      .prepare("SELECT * FROM session_strategies WHERE session_id = ?")
      .get(sessionId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new AppError(`Strategy config for session ${sessionId} was not found`, "NOT_FOUND", { sessionId });
    }
    return toSessionConfig(row);
  }

  updateConfig(sessionId: string, config: SessionConfig): SessionConfig {
    this.client.sqlite
      .prepare(
        `
        UPDATE session_strategies SET
          strategy_profile = @strategy_profile,
          max_position_usd = @max_position_usd,
          stop_loss_pct = @stop_loss_pct,
          take_profit_pct = @take_profit_pct,
          max_concurrent_trades = @max_concurrent_trades,
          research_depth = @research_depth,
          daily_loss_limit_usd = @daily_loss_limit_usd,
          profit_target_usd = @profit_target_usd,
          max_ai_spend_usd = @max_ai_spend_usd,
          human_approval_required = @human_approval_required
        WHERE session_id = @session_id
        `,
      )
      .run({
        session_id: sessionId,
        strategy_profile: config.strategy,
        max_position_usd: config.max_position_usd,
        stop_loss_pct: config.stop_loss_pct,
        take_profit_pct: config.take_profit_pct,
        max_concurrent_trades: config.max_concurrent_trades,
        research_depth: config.research_depth,
        daily_loss_limit_usd: config.daily_loss_limit_usd,
        profit_target_usd: config.profit_target_usd,
        max_ai_spend_usd: config.max_api_spend_usd,
        human_approval_required: config.human_approval_required ? 1 : 0,
      });
    return this.getConfig(sessionId);
  }
}
