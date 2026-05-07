import type { DashboardStats, SessionConfig } from "@/lib/types";
import type { OrderRequest } from "../broker/adapters/broker-adapter";
import { createLogger } from "../infra/log";

const logger = createLogger("risk-engine");

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
  /** Includes `instrumentType` for broker routing (Phase 8). */
  order: OrderRequest;
  confidence: number;
  maxExposureUsd?: number | null;
}

export class RiskEngine {
  preflightSession(input: SessionPreflight): RiskResult {
    if (!input.brokerConnected) {
      logger.warn({ brokerConnected: false }, "risk preflight denied");
      return { allowed: false, reason: "Broker is not connected" };
    }
    if (!input.aiKeyAvailable) {
      logger.warn({ aiKeyAvailable: false }, "risk preflight denied");
      return { allowed: false, reason: "Anthropic API key is not configured" };
    }
    const result = this.checkStats(input.config, input.stats);
    logger.info({ allowed: result.allowed, reason: result.reason ?? null }, "risk preflight evaluated");
    return result;
  }

  validateDecision(input: DecisionRiskInput): RiskResult<OrderRequest> {
    const statsResult = this.checkStats(input.config, input.stats);
    if (!statsResult.allowed) {
      logger.warn({ reason: statsResult.reason ?? null }, "risk decision denied by stats");
      return { allowed: false, reason: statsResult.reason };
    }
    if (input.order.sizeUsd <= 0) {
      logger.warn({ sizeUsd: input.order.sizeUsd }, "risk decision denied due to invalid size");
      return { allowed: false, reason: "Position size must be greater than zero" };
    }
    if (input.stats.open_trades >= input.config.max_concurrent_trades) {
      logger.warn(
        { openTrades: input.stats.open_trades, maxConcurrentTrades: input.config.max_concurrent_trades },
        "risk decision denied due to concurrent trade cap",
      );
      return { allowed: false, reason: "Maximum concurrent trades reached" };
    }
    if (input.order.sizeUsd > input.config.max_position_usd) {
      const reduced = {
        allowed: true,
        value: { ...input.order, sizeUsd: input.config.max_position_usd },
        reason: "Position size reduced to configured maximum",
      };
      logger.info({ originalSizeUsd: input.order.sizeUsd, reducedToUsd: input.config.max_position_usd }, "risk decision size reduced");
      return reduced;
    }
    if (
      input.order.instrumentType === "prediction_market" &&
      input.maxExposureUsd != null &&
      input.order.sizeUsd > input.maxExposureUsd
    ) {
      const reduced = {
        allowed: true,
        value: { ...input.order, sizeUsd: input.maxExposureUsd },
        reason: "Prediction-market position reduced to max exposure",
      };
      logger.info({ originalSizeUsd: input.order.sizeUsd, reducedToUsd: input.maxExposureUsd }, "risk decision exposure reduced");
      return reduced;
    }
    if (input.confidence < 0.6) {
      logger.warn({ confidence: input.confidence }, "risk decision denied due to confidence");
      return { allowed: false, reason: "Decision confidence is too low" };
    }
    logger.debug(
      {
        instrumentType: input.order.instrumentType,
        sizeUsd: input.order.sizeUsd,
        confidence: input.confidence,
      },
      "risk decision allowed",
    );
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
