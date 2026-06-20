import type { DashboardStats, SessionConfig } from "@/lib/types";
import type { OrderRequest } from "../broker/adapters/broker-adapter";
import type {
  DecisionCheck,
  HoldingStyle,
  RiskGateSizeAdjustment,
  RiskGateTrace,
  StrategySideBias,
} from "@electron/shared/domain";
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
  | "volatility_halt"
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
  /** Per-check trace, populated by validateDecision for observability. */
  trace?: RiskGateTrace;
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
  volatilityHaltMaxSpreadPct?: number | null;
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
    const checks: DecisionCheck[] = [];
    const sizeAdjustments: RiskGateSizeAdjustment[] = [];
    const buildTrace = (
      allowed: boolean,
      reason: string | null,
      gateType: RiskGateType | null,
      finalSizeUsd: number | null,
    ): RiskGateTrace => ({
      allowed,
      reason,
      gateType,
      checks,
      sizeAdjustments,
      finalSizeUsd,
    });

    const statsResult = this.checkStats(input.config, input.stats);
    checks.push({
      id: "session_limits",
      label: "Session limits",
      pass: statsResult.allowed,
      detail: statsResult.allowed ? null : (statsResult.reason ?? null),
    });
    if (!statsResult.allowed) {
      logger.warn(
        { reason: statsResult.reason ?? null },
        "risk decision denied by stats",
      );
      return {
        allowed: false,
        reason: statsResult.reason,
        gateType: statsResult.gateType,
        trace: buildTrace(
          false,
          statsResult.reason ?? null,
          statsResult.gateType ?? null,
          null,
        ),
      };
    }
    const sizePositive = input.order.sizeUsd > 0;
    checks.push({
      id: "position_size",
      label: "Position size > 0",
      pass: sizePositive,
      detail: sizePositive ? null : "Position size must be greater than zero",
      value: input.order.sizeUsd,
    });
    if (!sizePositive) {
      logger.warn(
        { sizeUsd: input.order.sizeUsd },
        "risk decision denied due to invalid size",
      );
      return {
        allowed: false,
        reason: "Position size must be greater than zero",
        gateType: "position_size",
        trace: buildTrace(
          false,
          "Position size must be greater than zero",
          "position_size",
          null,
        ),
      };
    }
    const underConcurrentCap =
      input.stats.open_trades < input.config.max_concurrent_trades;
    checks.push({
      id: "concurrent_cap",
      label: "Concurrent cap",
      pass: underConcurrentCap,
      detail: underConcurrentCap ? null : "Maximum concurrent trades reached",
      value: input.stats.open_trades,
      threshold: input.config.max_concurrent_trades,
    });
    if (!underConcurrentCap) {
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
        trace: buildTrace(
          false,
          "Maximum concurrent trades reached",
          "concurrent_cap",
          null,
        ),
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
        sizeAdjustments.push({
          reason: "ATR vol-target sizing",
          fromUsd: order.sizeUsd,
          toUsd: atrSizedUsd,
        });
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
      const withinGroupCap =
        groupExposure + order.sizeUsd <= input.maxSameGroupExposureUsd;
      checks.push({
        id: "asset_group_exposure",
        label: "Asset-group exposure",
        pass: withinGroupCap,
        detail: withinGroupCap
          ? null
          : `Asset group ${input.assetGroup} exposure cap reached`,
        value: groupExposure + order.sizeUsd,
        threshold: input.maxSameGroupExposureUsd,
      });
      if (!withinGroupCap) {
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
          trace: buildTrace(
            false,
            `Asset group ${input.assetGroup} exposure cap reached`,
            "position_size",
            null,
          ),
        };
      }
    }

    if (order.sizeUsd > input.config.max_position_usd) {
      sizeAdjustments.push({
        reason: "Reduced to configured max position",
        fromUsd: order.sizeUsd,
        toUsd: input.config.max_position_usd,
      });
      const reduced = {
        allowed: true,
        value: { ...order, sizeUsd: input.config.max_position_usd },
        reason: "Position size reduced to configured maximum",
        trace: buildTrace(true, null, null, input.config.max_position_usd),
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
      sizeAdjustments.push({
        reason: "Reduced to max exposure (prediction market)",
        fromUsd: order.sizeUsd,
        toUsd: maxExposureUsd,
      });
      const reduced = {
        allowed: true,
        value: { ...order, sizeUsd: maxExposureUsd },
        reason: "Prediction-market position reduced to max exposure",
        trace: buildTrace(true, null, null, maxExposureUsd),
      };
      logger.info(
        { originalSizeUsd: input.order.sizeUsd, reducedToUsd: maxExposureUsd },
        "risk decision exposure reduced",
      );
      return reduced;
    }
    if (
      input.volatilityHaltMaxSpreadPct != null &&
      input.volatilityHaltMaxSpreadPct > 0 &&
      input.quoteSnapshot?.spreadPct != null
    ) {
      const haltOk =
        input.quoteSnapshot.spreadPct <= input.volatilityHaltMaxSpreadPct;
      checks.push({
        id: "volatility_halt",
        label: "Volatility halt",
        pass: haltOk,
        detail: haltOk
          ? null
          : `Spread ${input.quoteSnapshot.spreadPct.toFixed(2)}% exceeds volatility halt threshold`,
        value: `${input.quoteSnapshot.spreadPct.toFixed(2)}%`,
        threshold: `${input.volatilityHaltMaxSpreadPct}%`,
      });
      if (!haltOk) {
        return {
          allowed: false,
          reason: `Spread ${input.quoteSnapshot.spreadPct.toFixed(2)}% exceeds volatility halt threshold`,
          gateType: "volatility_halt",
          trace: buildTrace(
            false,
            `Spread ${input.quoteSnapshot.spreadPct.toFixed(2)}% exceeds volatility halt threshold`,
            "volatility_halt",
            null,
          ),
        };
      }
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
    return {
      allowed: true,
      value: order,
      trace: buildTrace(true, null, null, order.sizeUsd),
    };
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
