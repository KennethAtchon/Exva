import type { DbClient } from "../client";
import type { SessionRiskConfig } from "@/lib/types";
import { AppError } from "@electron/shared/errors";
import { toSessionRiskConfig } from "./mappers";

export class SessionRiskConfigRepo {
  constructor(private readonly client: DbClient) {}

  get(sessionId: string): SessionRiskConfig {
    const row = this.client.sqlite
      .prepare("SELECT * FROM session_risk_config WHERE session_id = ?")
      .get(sessionId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new AppError(`Risk config for session ${sessionId} was not found`, "NOT_FOUND", { sessionId });
    }
    return toSessionRiskConfig(row);
  }

  upsert(sessionId: string, patch: Partial<SessionRiskConfig>): SessionRiskConfig {
    const current = this.get(sessionId);
    const next: SessionRiskConfig = {
      ...current,
      ...patch,
      sessionId,
      updatedAt: new Date().toISOString(),
    };

    this.client.sqlite
      .prepare(
        `
        UPDATE session_risk_config SET
          max_position_usd = @max_position_usd,
          stop_loss_pct = @stop_loss_pct,
          take_profit_pct = @take_profit_pct,
          stop_loss_type = @stop_loss_type,
          atr_stop_multiplier = @atr_stop_multiplier,
          kelly_fraction = @kelly_fraction,
          prediction_edge_threshold = @prediction_edge_threshold,
          max_exposure_usd = @max_exposure_usd,
          wait_for_open_threshold = @wait_for_open_threshold,
          max_concurrent_trades = @max_concurrent_trades,
          daily_loss_limit_usd = @daily_loss_limit_usd,
          profit_target_usd = @profit_target_usd,
          max_ai_spend_usd = @max_ai_spend_usd,
          human_approval_required = @human_approval_required,
          updated_at = @updated_at
        WHERE session_id = @session_id
        `,
      )
      .run({
        session_id: sessionId,
        max_position_usd: next.maxPositionUsd,
        stop_loss_pct: next.stopLossPct,
        take_profit_pct: next.takeProfitPct,
        stop_loss_type: next.stopLossType,
        atr_stop_multiplier: next.atrStopMultiplier,
        kelly_fraction: next.kellyFraction,
        prediction_edge_threshold: next.predictionEdgeThreshold,
        max_exposure_usd: next.maxExposureUsd,
        wait_for_open_threshold: next.waitForOpenThreshold,
        max_concurrent_trades: next.maxConcurrentTrades,
        daily_loss_limit_usd: next.dailyLossLimitUsd,
        profit_target_usd: next.profitTargetUsd,
        max_ai_spend_usd: next.maxAiSpendUsd,
        human_approval_required: next.humanApprovalRequired ? 1 : 0,
        updated_at: next.updatedAt,
      });

    return this.get(sessionId);
  }
}
