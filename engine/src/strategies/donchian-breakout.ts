import { z } from "zod";
import { fmtNum, round } from "../util.ts";
import { priorHigh, priorLow } from "./indicators.ts";
import { ALL_TIMEFRAMES, type Signal, type Strategy } from "./types.ts";

const params = z.object({
  entryBars: z.number().int().min(5).max(200).default(20).meta({
    title: "Breakout lookback",
    description: "Buy on a close above the high of this many bars.",
  }),
  exitBars: z.number().int().min(3).max(200).default(10).meta({
    title: "Exit lookback",
    description: "Sell on a close below the low of this many bars.",
  }),
});

export const donchianBreakout: Strategy<z.infer<typeof params>> = {
  id: "donchian-breakout",
  name: "Donchian Breakout",
  description:
    "A slower trend follower: buys when price closes above its recent high and sells when it closes below a shorter recent low.",
  params,
  timeframes: ALL_TIMEFRAMES,
  defaultTimeframe: "1h",
  defaultSymbols: ["SPY", "QQQ", "IWM", "AAPL", "MSFT", "NVDA", "AMZN", "META", "GOOGL", "TSLA"],
  warmup: (p) => Math.max(p.entryBars, p.exitBars) + 1,
  decide({ bars, position, params: p }): Signal {
    const close = (bars[bars.length - 1] ?? { c: Number.NaN }).c;
    if (!position) {
      const hi = priorHigh(bars, p.entryBars);
      const values = { close, high: round(hi, 4) };
      if (close > hi) {
        return {
          action: "buy",
          reason: `Close ${fmtNum(close)} broke above the ${p.entryBars}-bar high ${fmtNum(hi)}`,
          values,
        };
      }
      const distance = round(((hi - close) / close) * 100, 3);
      return {
        action: "hold",
        reason: `Close ${fmtNum(close)} is ${round(distance, 2)}% below the ${p.entryBars}-bar high ${fmtNum(hi)}`,
        values: { ...values, distance },
      };
    }
    const lo = priorLow(bars, p.exitBars);
    const values = { close, low: round(lo, 4) };
    if (close < lo) {
      return {
        action: "sell",
        reason: `Close ${fmtNum(close)} broke below the ${p.exitBars}-bar low ${fmtNum(lo)}`,
        values,
      };
    }
    return {
      action: "hold",
      reason: `Holding: close ${fmtNum(close)}, sells below ${fmtNum(lo)}`,
      values,
    };
  },
};
