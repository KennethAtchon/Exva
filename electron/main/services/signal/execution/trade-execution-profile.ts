import type {
  ExecutionStrategyType,
  TradeSignal,
} from "@electron/shared/ai/trade-signals";
import type { InstrumentClass } from "@/lib/types";

interface ExecutionRiskConfig {
  stopLossPct: number | null;
  takeProfitPct: number | null;
  kellyFraction: number;
}

export interface TradeTradeExecutionProfileInput {
  signal: TradeSignal;
  instrumentClass: InstrumentClass;
  maxPositionUsd: number;
  maxExposureUsd: number | null;
  risk: ExecutionRiskConfig;
  reviewRecommendation?: "proceed" | "reduce_size" | "skip";
}

export interface TradeExecutionProfile {
  positionSizeUsd: number;
  side: "BUY" | "SELL";
  stopLossPct: number | null;
  takeProfitPct: number | null;
  orderType: "market" | "limit";
  limitPrice: number | null;
}

type StrategyProfile = {
  sizeFactor: number;
  stopLossFactor: number;
  takeProfitFactor: number;
};

const VALID_STRATEGIES: Record<
  InstrumentClass,
  readonly ExecutionStrategyType[]
> = {
  stock: ["trend_momentum", "breakout", "mean_reversion", "event_driven"],
  crypto: ["trend_momentum", "breakout", "mean_reversion", "arbitrage"],
  futures: ["futures_trend", "trend_momentum", "event_driven"],
  options: ["trend_momentum", "breakout", "mean_reversion", "event_driven"],
  prediction_market: ["prediction_market"],
};

const STRATEGY_PROFILES: Record<ExecutionStrategyType, StrategyProfile> = {
  trend_momentum: { sizeFactor: 1, stopLossFactor: 1, takeProfitFactor: 1 },
  breakout: { sizeFactor: 1, stopLossFactor: 1, takeProfitFactor: 1 },
  mean_reversion: { sizeFactor: 0.5, stopLossFactor: 1, takeProfitFactor: 1 },
  event_driven: { sizeFactor: 0.5, stopLossFactor: 1, takeProfitFactor: 1 },
  arbitrage: { sizeFactor: 0.5, stopLossFactor: 1, takeProfitFactor: 1 },
  prediction_market: { sizeFactor: 1, stopLossFactor: 1, takeProfitFactor: 1 },
  futures_trend: { sizeFactor: 1, stopLossFactor: 1, takeProfitFactor: 1 },
};

export function computeTradeTradeExecutionProfile(
  input: TradeTradeExecutionProfileInput,
): TradeExecutionProfile {
  const {
    signal,
    instrumentClass,
    maxPositionUsd,
    maxExposureUsd,
    risk,
    reviewRecommendation,
  } = input;

  if (signal.action === "skip") {
    throw new Error("Cannot compute execution profile for skip signal");
  }

  const strategy = resolveExecutionStrategy(
    signal.executionStrategy,
    instrumentClass,
  );
  const profile = STRATEGY_PROFILES[strategy];
  const kelly = Math.max(0, Math.min(1, risk.kellyFraction));
  const confidence = Math.max(0, Math.min(1, signal.confidence));

  let positionSizeUsd = basePositionUsd({
    profile,
    instrumentClass,
    maxPositionUsd,
    maxExposureUsd,
    confidence,
    kelly,
  });

  if (reviewRecommendation === "reduce_size") {
    positionSizeUsd *= 0.5;
  }

  const capped = capPosition(positionSizeUsd, maxPositionUsd, maxExposureUsd);
  const orderType = signal.entryPrice != null ? "limit" : "market";

  return {
    positionSizeUsd: capped,
    side: signal.action === "sell" ? "SELL" : "BUY",
    stopLossPct: scaleRiskPct(risk.stopLossPct, profile.stopLossFactor),
    takeProfitPct: scaleRiskPct(risk.takeProfitPct, profile.takeProfitFactor),
    orderType,
    limitPrice: signal.entryPrice,
  };
}

export function priceLevelsFromProfile(
  side: "BUY" | "SELL",
  entryPrice: number,
  profile: Pick<TradeExecutionProfile, "stopLossPct" | "takeProfitPct">,
): { stopLossPrice: number | null; takeProfitPrice: number | null } {
  const { stopLossPct, takeProfitPct } = profile;
  if (entryPrice <= 0) return { stopLossPrice: null, takeProfitPrice: null };

  let stopLossPrice: number | null = null;
  let takeProfitPrice: number | null = null;

  if (stopLossPct != null && stopLossPct > 0) {
    const delta = entryPrice * (stopLossPct / 100);
    stopLossPrice = side === "BUY" ? entryPrice - delta : entryPrice + delta;
  }
  if (takeProfitPct != null && takeProfitPct > 0) {
    const delta = entryPrice * (takeProfitPct / 100);
    takeProfitPrice = side === "BUY" ? entryPrice + delta : entryPrice - delta;
  }

  return { stopLossPrice, takeProfitPrice };
}

function resolveExecutionStrategy(
  strategy: ExecutionStrategyType,
  instrumentClass: InstrumentClass,
): ExecutionStrategyType {
  const allowed = VALID_STRATEGIES[instrumentClass];
  if (allowed.includes(strategy)) return strategy;
  return allowed[0] ?? "trend_momentum";
}

function basePositionUsd(args: {
  profile: StrategyProfile;
  instrumentClass: InstrumentClass;
  maxPositionUsd: number;
  maxExposureUsd: number | null;
  confidence: number;
  kelly: number;
}): number {
  const {
    profile,
    instrumentClass,
    maxPositionUsd,
    maxExposureUsd,
    confidence,
    kelly,
  } = args;

  if (instrumentClass === "prediction_market") {
    const cap =
      maxExposureUsd != null
        ? Math.min(maxPositionUsd, maxExposureUsd)
        : maxPositionUsd;
    return cap * kelly * confidence * profile.sizeFactor;
  }

  return maxPositionUsd * confidence * kelly * profile.sizeFactor;
}

function capPosition(
  sizeUsd: number,
  maxPositionUsd: number,
  maxExposureUsd: number | null,
): number {
  const capped = Math.min(sizeUsd, maxPositionUsd);
  if (maxExposureUsd != null) return Math.min(capped, maxExposureUsd);
  return capped;
}

function scaleRiskPct(value: number | null, factor: number): number | null {
  if (value == null) return null;
  return value * factor;
}
