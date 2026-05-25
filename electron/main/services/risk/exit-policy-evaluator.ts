import type { InstrumentClass } from "@/lib/types";
import type { StopLossType } from "@electron/shared/domain";

type ExitReason = "stop_loss_fixed" | "stop_loss_trailing_atr" | "take_profit";

export interface ExitDecision {
  shouldExit: boolean;
  reason?: ExitReason;
  triggerPrice?: number;
}

type OhlcvBar = { high: number; low: number; close: number };

export interface ExitPolicyInput {
  trade: {
    id: string;
    entryPrice: number;
    side: "BUY" | "SELL";
    instrumentType: InstrumentClass;
    highWaterMarkPrice: number | null;
  };
  currentPrice: number;
  ohlcvBars: OhlcvBar[];
  riskConfig: {
    stopLossType: StopLossType;
    stopLossPct: number | null;
    atrStopMultiplier: number | null;
    takeProfitPct: number | null;
  };
  now?: string;
}

export class ExitPolicyEvaluator {
  evaluate(input: ExitPolicyInput): ExitDecision {
    const { trade, currentPrice, ohlcvBars, riskConfig } = input;

    if (trade.instrumentType === "prediction_market") {
      return { shouldExit: false };
    }

    const { stopLossType, stopLossPct, atrStopMultiplier, takeProfitPct } =
      riskConfig;
    const { entryPrice, side } = trade;
    const isLong = side === "BUY";

    // Take-profit checked first — more favorable exit takes priority
    if (takeProfitPct != null) {
      const tpPrice = isLong
        ? entryPrice * (1 + takeProfitPct / 100)
        : entryPrice * (1 - takeProfitPct / 100);
      const triggered = isLong
        ? currentPrice >= tpPrice
        : currentPrice <= tpPrice;
      if (triggered) {
        return {
          shouldExit: true,
          reason: "take_profit",
          triggerPrice: tpPrice,
        };
      }
    }

    if (stopLossType === "none" || stopLossType === "broker_native_trailing") {
      return { shouldExit: false };
    }

    if (stopLossType === "fixed_pct") {
      if (stopLossPct == null) return { shouldExit: false };
      const stopPrice = isLong
        ? entryPrice * (1 - stopLossPct / 100)
        : entryPrice * (1 + stopLossPct / 100);
      const triggered = isLong
        ? currentPrice <= stopPrice
        : currentPrice >= stopPrice;
      if (triggered) {
        return {
          shouldExit: true,
          reason: "stop_loss_fixed",
          triggerPrice: stopPrice,
        };
      }
    }

    if (stopLossType === "trailing_atr") {
      if (atrStopMultiplier == null) return { shouldExit: false };
      const atr = computeATR(ohlcvBars);
      if (atr == null) return { shouldExit: false };

      if (isLong) {
        const hwm = Math.max(
          trade.highWaterMarkPrice ?? entryPrice,
          currentPrice,
        );
        const trailStop = hwm - atrStopMultiplier * atr;
        if (currentPrice <= trailStop) {
          return {
            shouldExit: true,
            reason: "stop_loss_trailing_atr",
            triggerPrice: trailStop,
          };
        }
      } else {
        const lwm = Math.min(
          trade.highWaterMarkPrice ?? entryPrice,
          currentPrice,
        );
        const trailStop = lwm + atrStopMultiplier * atr;
        if (currentPrice >= trailStop) {
          return {
            shouldExit: true,
            reason: "stop_loss_trailing_atr",
            triggerPrice: trailStop,
          };
        }
      }
    }

    return { shouldExit: false };
  }
}

function computeATR(bars: OhlcvBar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  const recent = bars.slice(-(period + 1));

  const trueRanges = recent.slice(1).map((bar, i) => {
    const prev = recent[i];
    if (!prev) return bar.high - bar.low;
    return Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - prev.close),
      Math.abs(bar.low - prev.close),
    );
  });

  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (const tr of trueRanges.slice(period)) {
    atr = (atr * (period - 1) + tr) / period;
  }

  return atr;
}
