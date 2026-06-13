import type { DashboardStats, SessionConfig } from "@/lib/types";
import type { OrderRequest } from "../broker/adapters/broker-adapter";
import type { HoldingStyle, StrategySideBias } from "@electron/shared/domain";
import { createLogger } from "../infra/log";

const logger = createLogger("risk-engine");

export const WAIT_FOR_OPEN_REJECTION_REASON =
  "Decision confidence is below wait-for-open threshold";

export function isWaitForOpenRejection(reason?: string): boolean {
  return reason === WAIT_FOR_OPEN_REJECTION_REASON;
}

export type RiskGateType =
  | "api_budget"
  | "daily_loss"
  | "profit_target"
  | "consecutive_losers"
  | "concurrent_cap"
  | "position_size"
  | "confidence"
  | "broker_disconnected"
  | "ai_key_missing";

export interface RiskResult<T = undefined> {
  allowed: boolean;
  reason?: string;
  gateType?: RiskGateType;
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
  riskPolicy?: {
    waitForOpenThreshold: number;
    maxExposureUsd: number | null;
  };
  maxExposureUsd?: number | null;

  // Required for policy gate checks
  quoteSnapshot?: {
    price: number;
    bid?: number;
    ask?: number;
    spreadPct?: number;
    volume?: number;
    timestamp: string;
  };
  placementQuoteSnapshot?: {
    price: number;
    timestamp: string;
  };
  side?: "BUY" | "SELL";
  exitPolicy?: {
    stopLossPct?: number | null;
    atrStopMultiplier?: number | null;
    takeProfitPct?: number | null;
    maxHoldDays?: number | null;
  };
  totalBrokerExposureUsd?: number;
  strategyRules?: {
    sideBias: StrategySideBias;
  };
  sessionMode?: "paper" | "live";
  brokerSupportsClass?: boolean;
  marketIsOpen?: boolean;
  holdingStyle?: HoldingStyle;
  /** ATR in USD for vol-targeted sizing (audit §8.3). */
  atrUsd?: number | null;
  sizingMode?: "flat_usd" | "atr_vol_target";
  riskPerTradePct?: number | null;
  /** Asset exposure bucket for correlation cap (audit §8.3). */
  assetGroup?: "equities_beta" | "crypto" | "commodities" | "rates" | "other";
  openExposureByGroupUsd?: Partial<
    Record<NonNullable<DecisionRiskInput["assetGroup"]>, number>
  >;
  maxSameGroupExposureUsd?: number | null;
}

export class RiskEngine {
  preflightSession(input: SessionPreflight): RiskResult {
    if (!input.brokerConnected) {
      logger.warn({ brokerConnected: false }, "risk preflight denied");
      return {
        allowed: false,
        reason: "Broker is not connected",
        gateType: "broker_disconnected",
      };
    }
    if (!input.aiKeyAvailable) {
      logger.warn({ aiKeyAvailable: false }, "risk preflight denied");
      return {
        allowed: false,
        reason: "Anthropic API key is not configured",
        gateType: "ai_key_missing",
      };
    }
    const result = this.checkStats(input.config, input.stats);
    logger.info(
      { allowed: result.allowed, reason: result.reason ?? null },
      "risk preflight evaluated",
    );
    return result;
  }

  validateDecision(input: DecisionRiskInput): RiskResult<OrderRequest> {
    const statsResult = this.checkStats(input.config, input.stats);
    if (!statsResult.allowed) {
      logger.warn(
        { reason: statsResult.reason ?? null },
        "risk decision denied by stats",
      );
      return {
        allowed: false,
        reason: statsResult.reason,
        gateType: statsResult.gateType,
      };
    }
    if (input.order.sizeUsd <= 0) {
      logger.warn(
        { sizeUsd: input.order.sizeUsd },
        "risk decision denied due to invalid size",
      );
      return {
        allowed: false,
        reason: "Position size must be greater than zero",
        gateType: "position_size",
      };
    }
    if (input.stats.open_trades >= input.config.max_concurrent_trades) {
      logger.warn(
        {
          openTrades: input.stats.open_trades,
          maxConcurrentTrades: input.config.max_concurrent_trades,
        },
        "risk decision denied due to concurrent trade cap",
      );
      return {
        allowed: false,
        reason: "Maximum concurrent trades reached",
        gateType: "concurrent_cap",
      };
    }
    let order = { ...input.order };
    if (
      input.sizingMode === "atr_vol_target" &&
      input.atrUsd != null &&
      input.atrUsd > 0 &&
      input.riskPerTradePct != null &&
      input.riskPerTradePct > 0
    ) {
      const equityUsd =
        input.stats.portfolio_value > 0
          ? input.stats.portfolio_value
          : input.config.max_position_usd * 10;
      const riskBudgetUsd = equityUsd * input.riskPerTradePct;
      const atrSizedUsd = riskBudgetUsd / input.atrUsd;
      if (atrSizedUsd > 0 && atrSizedUsd < order.sizeUsd) {
        order = { ...order, sizeUsd: atrSizedUsd };
        logger.info(
          {
            atrUsd: input.atrUsd,
            atrSizedUsd,
            riskPerTradePct: input.riskPerTradePct,
          },
          "risk decision ATR vol-target size applied",
        );
      }
    }

    if (
      input.assetGroup &&
      input.maxSameGroupExposureUsd != null &&
      input.openExposureByGroupUsd
    ) {
      const groupExposure = input.openExposureByGroupUsd[input.assetGroup] ?? 0;
      if (groupExposure + order.sizeUsd > input.maxSameGroupExposureUsd) {
        logger.warn(
          {
            assetGroup: input.assetGroup,
            groupExposure,
            max: input.maxSameGroupExposureUsd,
          },
          "risk decision denied due to asset-group exposure cap",
        );
        return {
          allowed: false,
          reason: `Asset group ${input.assetGroup} exposure cap reached`,
          gateType: "position_size",
        };
      }
    }

    if (order.sizeUsd > input.config.max_position_usd) {
      const reduced = {
        allowed: true,
        value: { ...order, sizeUsd: input.config.max_position_usd },
        reason: "Position size reduced to configured maximum",
      };
      logger.info(
        {
          originalSizeUsd: input.order.sizeUsd,
          reducedToUsd: input.config.max_position_usd,
        },
        "risk decision size reduced",
      );
      return reduced;
    }
    const maxExposureUsd = this.maxExposureUsd(input);
    if (
      input.order.instrumentType === "prediction_market" &&
      maxExposureUsd != null &&
      order.sizeUsd > maxExposureUsd
    ) {
      const reduced = {
        allowed: true,
        value: { ...order, sizeUsd: maxExposureUsd },
        reason: "Prediction-market position reduced to max exposure",
      };
      logger.info(
        { originalSizeUsd: input.order.sizeUsd, reducedToUsd: maxExposureUsd },
        "risk decision exposure reduced",
      );
      return reduced;
    }
    // Confidence gating is owned by trade-signal-aggregator; risk engine does not re-check.
    logger.debug(
      {
        instrumentType: input.order.instrumentType,
        sizeUsd: order.sizeUsd,
        confidence: input.confidence,
      },
      "risk decision allowed",
    );
    return { allowed: true, value: order };
  }

  checkSessionLimits(
    config: SessionConfig,
    stats: DashboardStats,
  ): string | null {
    const result = this.checkStats(config, stats);
    return result.allowed ? null : (result.reason ?? "Risk limit reached");
  }

  private checkStats(config: SessionConfig, stats: DashboardStats): RiskResult {
    if (stats.daily_api_spend >= config.max_api_spend_usd) {
      return {
        allowed: false,
        reason: "Daily API budget reached",
        gateType: "api_budget",
      };
    }
    if (stats.daily_pnl_usd <= -Math.abs(config.daily_loss_limit_usd)) {
      return {
        allowed: false,
        reason: "Daily loss limit reached",
        gateType: "daily_loss",
      };
    }
    if (stats.daily_pnl_usd >= config.profit_target_usd) {
      return {
        allowed: false,
        reason: "Profit target reached",
        gateType: "profit_target",
      };
    }
    if (
      stats.consecutive_losers >= config.max_consecutive_losers &&
      config.max_consecutive_losers > 0
    ) {
      return {
        allowed: false,
        reason: "Maximum consecutive losers reached",
        gateType: "consecutive_losers",
      };
    }
    return { allowed: true };
  }

  private maxExposureUsd(input: DecisionRiskInput): number | null | undefined {
    return input.riskPolicy?.maxExposureUsd ?? input.maxExposureUsd;
  }
}
