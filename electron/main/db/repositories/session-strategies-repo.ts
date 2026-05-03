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

  update(sessionId: string, patch: Partial<SessionStrategy>): SessionStrategy {
    const current = this.get(sessionId);
    const next: SessionStrategy = {
      ...current,
      ...patch,
      sessionId,
    };

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
          human_approval_required = @human_approval_required,
          primary_trading_timeframe = @primary_trading_timeframe,
          holding_style = @holding_style,
          target_hold_days = @target_hold_days,
          max_hold_days = @max_hold_days,
          timeframe_notes = @timeframe_notes
        WHERE session_id = @session_id
        `,
      )
      .run({
        session_id: sessionId,
        strategy_profile: next.strategyProfile,
        max_position_usd: next.maxPositionUsd,
        stop_loss_pct: next.stopLossPct,
        take_profit_pct: next.takeProfitPct,
        max_concurrent_trades: next.maxConcurrentTrades,
        research_depth: next.researchDepth,
        daily_loss_limit_usd: next.dailyLossLimitUsd,
        profit_target_usd: next.profitTargetUsd,
        max_ai_spend_usd: next.maxAiSpendUsd,
        human_approval_required: next.humanApprovalRequired ? 1 : 0,
        primary_trading_timeframe: next.primaryTradingTimeframe,
        holding_style: next.holdingStyle,
        target_hold_days: next.targetHoldDays,
        max_hold_days: next.maxHoldDays,
        timeframe_notes: next.timeframeNotes,
      });

    return this.get(sessionId);
  }

  getConfig(sessionId: string): SessionConfig {
    // TODO(phase-05): Remove this compatibility bridge once SessionConfig is deleted
    // and callers use SessionStrategy directly.
    const row = this.client.sqlite
      .prepare("SELECT * FROM session_strategies WHERE session_id = ?")
      .get(sessionId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new AppError(`Strategy config for session ${sessionId} was not found`, "NOT_FOUND", { sessionId });
    }
    return toSessionConfig(row);
  }

  updateConfig(sessionId: string, config: SessionConfig): SessionConfig {
    // TODO(phase-05): Remove this compatibility writer once SessionConfig is deleted
    // and callers write SessionStrategy fields directly.
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
