import type { ExecutionStrategyType, TradeSignal } from "@electron/shared/ai/pipeline-signals";
import type { InstrumentClass } from "@/lib/types";

export interface ExecutionRiskConfig {
  stopLossPct: number | null;
  takeProfitPct: number | null;
  kellyFraction: number;
}

export interface ExecutionProfileInput {
  signal: TradeSignal;
  instrumentClass: InstrumentClass;
  maxPositionUsd: number;
  maxExposureUsd: number | null;
  risk: ExecutionRiskConfig;
  reviewRecommendation?: "proceed" | "reduce_size" | "skip";
}

export interface ExecutionProfile {
  positionSizeUsd: number;
  side: "BUY" | "SELL";
  stopLossPct: number | null;
  takeProfitPct: number | null;
  orderType: "market" | "limit";
  limitPrice: number | null;
}

const VALID_STRATEGIES: Record<InstrumentClass, readonly ExecutionStrategyType[]> = {
  stock: ["trend_momentum", "breakout", "mean_reversion", "event_driven"],
  crypto: ["trend_momentum", "breakout", "mean_reversion"],
  futures: ["futures_trend", "trend_momentum", "event_driven"],
  prediction_market: ["prediction_market"],
};

const STRATEGY_SIZE_FACTOR: Partial<Record<ExecutionStrategyType, number>> = {
  mean_reversion: 0.5,
  event_driven: 0.5,
  arbitrage: 0.5,
};

export function computeExecutionProfile(input: ExecutionProfileInput): ExecutionProfile {
  const { signal, instrumentClass, maxPositionUsd, maxExposureUsd, risk, reviewRecommendation } = input;

  if (signal.action === "skip") {
    throw new Error("Cannot compute execution profile for skip signal");
  }

  const strategy = resolveExecutionStrategy(signal.executionStrategy, instrumentClass);
  const kelly = Math.max(0, Math.min(1, risk.kellyFraction));
  const confidence = Math.max(0, Math.min(1, signal.confidence));

  let positionSizeUsd = basePositionUsd({
    strategy,
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
    stopLossPct: risk.stopLossPct,
    takeProfitPct: risk.takeProfitPct,
    orderType,
    limitPrice: signal.entryPrice,
  };
}

export function priceLevelsFromProfile(
  side: "BUY" | "SELL",
  entryPrice: number,
  profile: Pick<ExecutionProfile, "stopLossPct" | "takeProfitPct">,
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
  strategy: ExecutionStrategyType;
  instrumentClass: InstrumentClass;
  maxPositionUsd: number;
  maxExposureUsd: number | null;
  confidence: number;
  kelly: number;
}): number {
  const { strategy, instrumentClass, maxPositionUsd, maxExposureUsd, confidence, kelly } = args;

  if (instrumentClass === "prediction_market") {
    const cap = maxExposureUsd != null ? Math.min(maxPositionUsd, maxExposureUsd) : maxPositionUsd;
    return cap * kelly * confidence;
  }

  const factor = STRATEGY_SIZE_FACTOR[strategy] ?? 1;
  return maxPositionUsd * confidence * kelly * factor;
}

function capPosition(sizeUsd: number, maxPositionUsd: number, maxExposureUsd: number | null): number {
  const capped = Math.min(sizeUsd, maxPositionUsd);
  if (maxExposureUsd != null) return Math.min(capped, maxExposureUsd);
  return capped;
}
