import type { DashboardStats, SessionConfig } from "@/lib/types";
import type { OrderRequest } from "../broker/broker-adapter";

export interface RiskResult<T = undefined> {
  allowed: boolean;
  reason?: string;
  value?: T;
}

export interface SessionPreflight {
  config: SessionConfig;
  stats: DashboardStats;
  brokerConnected: boolean;
  aiKeyAvailable: boolean;
}

export interface DecisionRiskInput {
  config: SessionConfig;
  stats: DashboardStats;
  order: OrderRequest;
  confidence: number;
}

export class RiskEngine {
  preflightSession(input: SessionPreflight): RiskResult {
    if (!input.brokerConnected) return { allowed: false, reason: "Broker is not connected" };
    if (!input.aiKeyAvailable) return { allowed: false, reason: "Anthropic API key is not configured" };
    return this.checkStats(input.config, input.stats);
  }

  validateDecision(input: DecisionRiskInput): RiskResult<OrderRequest> {
    const statsResult = this.checkStats(input.config, input.stats);
    if (!statsResult.allowed) return statsResult;
    if (input.stats.open_trades >= input.config.max_concurrent_trades) {
      return { allowed: false, reason: "Maximum concurrent trades reached" };
    }
    if (input.order.sizeUsd > input.config.max_position_usd) {
      return {
        allowed: true,
        value: { ...input.order, sizeUsd: input.config.max_position_usd },
        reason: "Position size reduced to configured maximum",
      };
    }
    if (input.confidence < 0.6) return { allowed: false, reason: "Decision confidence is too low" };
    return { allowed: true, value: input.order };
  }

  checkSessionLimits(config: SessionConfig, stats: DashboardStats): string | null {
    const result = this.checkStats(config, stats);
    return result.allowed ? null : result.reason ?? "Risk limit reached";
  }

  private checkStats(config: SessionConfig, stats: DashboardStats): RiskResult {
    if (stats.daily_api_spend >= config.max_api_spend_usd) {
      return { allowed: false, reason: "Daily API budget reached" };
    }
    if (stats.daily_pnl_usd <= -Math.abs(config.daily_loss_limit_usd)) {
      return { allowed: false, reason: "Daily loss limit reached" };
    }
    if (stats.daily_pnl_usd >= config.profit_target_usd) {
      return { allowed: false, reason: "Profit target reached" };
    }
    return { allowed: true };
  }
}
