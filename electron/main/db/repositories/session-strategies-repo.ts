import type { DbClient } from "../client";
import type { SessionConfig, SessionStrategy } from "@/lib/types";
import { eq } from "drizzle-orm";
import { sessionRiskConfig, sessionStrategies, sessionStrategyProfile, sessionTimeframeConfig } from "../schema";
import { AppError } from "@electron/shared/errors";
import { toSessionConfig, toSessionStrategy } from "./mappers";

export class SessionStrategiesRepo {
  constructor(private readonly client: DbClient) {}

  get(sessionId: string): SessionStrategy {
    const row = this.client.db.select().from(sessionStrategies).where(eq(sessionStrategies.sessionId, sessionId)).get();
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

    const updatedAt = new Date().toISOString();

    this.client.db.transaction((tx) => {
      tx.update(sessionStrategies)
        .set({
          strategyProfile: next.strategyProfile,
          maxPositionUsd: next.maxPositionUsd,
          stopLossPct: next.stopLossPct,
          takeProfitPct: next.takeProfitPct,
          maxConcurrentTrades: next.maxConcurrentTrades,
          researchDepth: next.researchDepth,
          dailyLossLimitUsd: next.dailyLossLimitUsd,
          profitTargetUsd: next.profitTargetUsd,
          maxAiSpendUsd: next.maxAiSpendUsd,
          humanApprovalRequired: next.humanApprovalRequired,
          primaryTradingTimeframe: next.primaryTradingTimeframe,
          holdingStyle: next.holdingStyle,
          targetHoldDays: next.targetHoldDays,
          maxHoldDays: next.maxHoldDays,
          timeframeNotes: next.timeframeNotes,
        })
        .where(eq(sessionStrategies.sessionId, sessionId))
        .run();

      tx.update(sessionStrategyProfile)
        .set({ updatedAt })
        .where(eq(sessionStrategyProfile.sessionId, sessionId))
        .run();

      tx.update(sessionRiskConfig)
        .set({
          maxPositionUsd: next.maxPositionUsd,
          stopLossPct: next.stopLossPct,
          takeProfitPct: next.takeProfitPct,
          maxConcurrentTrades: next.maxConcurrentTrades,
          dailyLossLimitUsd: next.dailyLossLimitUsd,
          profitTargetUsd: next.profitTargetUsd,
          maxAiSpendUsd: next.maxAiSpendUsd,
          humanApprovalRequired: next.humanApprovalRequired,
          updatedAt,
        })
        .where(eq(sessionRiskConfig.sessionId, sessionId))
        .run();

      tx.update(sessionTimeframeConfig)
        .set({
          primaryTradingTimeframe: next.primaryTradingTimeframe,
          holdingStyle: next.holdingStyle,
          targetHoldDays: next.targetHoldDays,
          maxHoldDays: next.maxHoldDays,
          timeframeNotes: next.timeframeNotes,
          updatedAt,
        })
        .where(eq(sessionTimeframeConfig.sessionId, sessionId))
        .run();
    });

    return this.get(sessionId);
  }

  getConfig(sessionId: string): SessionConfig {
    const row = this.client.db.select().from(sessionStrategies).where(eq(sessionStrategies.sessionId, sessionId)).get();
    if (!row) {
      throw new AppError(`Strategy config for session ${sessionId} was not found`, "NOT_FOUND", { sessionId });
    }
    return toSessionConfig(row);
  }

  updateConfig(sessionId: string, config: SessionConfig): SessionConfig {
    const updatedAt = new Date().toISOString();

    this.client.db.transaction((tx) => {
      tx.update(sessionStrategies)
        .set({
          strategyProfile: config.strategy,
          maxPositionUsd: config.max_position_usd,
          stopLossPct: config.stop_loss_pct,
          takeProfitPct: config.take_profit_pct,
          maxConcurrentTrades: config.max_concurrent_trades,
          researchDepth: config.research_depth,
          dailyLossLimitUsd: config.daily_loss_limit_usd,
          profitTargetUsd: config.profit_target_usd,
          maxAiSpendUsd: config.max_api_spend_usd,
          humanApprovalRequired: config.human_approval_required,
        })
        .where(eq(sessionStrategies.sessionId, sessionId))
        .run();

      tx.update(sessionRiskConfig)
        .set({
          maxPositionUsd: config.max_position_usd,
          stopLossPct: config.stop_loss_pct,
          takeProfitPct: config.take_profit_pct,
          maxConcurrentTrades: config.max_concurrent_trades,
          dailyLossLimitUsd: config.daily_loss_limit_usd,
          profitTargetUsd: config.profit_target_usd,
          maxAiSpendUsd: config.max_api_spend_usd,
          humanApprovalRequired: config.human_approval_required,
          updatedAt,
        })
        .where(eq(sessionRiskConfig.sessionId, sessionId))
        .run();
    });

    return this.getConfig(sessionId);
  }
}
