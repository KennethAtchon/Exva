import { z } from "zod";
import { round } from "../util.ts";
import { last, rsi } from "./indicators.ts";
import { ALL_TIMEFRAMES, type Signal, type Strategy } from "./types.ts";

const params = z
  .object({
    period: z
      .number()
      .int()
      .min(2)
      .max(50)
      .default(2)
      .meta({ title: "RSI period", description: "Bars in the RSI." }),
    buyBelow: z
      .number()
      .min(1)
      .max(50)
      .default(10)
      .meta({ title: "Buy below", description: "Buy when RSI drops under this." }),
    sellAbove: z
      .number()
      .min(30)
      .max(99)
      .default(70)
      .meta({ title: "Sell above", description: "Sell when RSI rises over this." }),
  })
  .refine((p) => p.buyBelow < p.sellAbove, { message: "Buy level must be below sell level" });

export const rsiDip: Strategy<z.infer<typeof params>> = {
  id: "rsi-dip",
  name: "RSI Dip Buyer",
  description:
    "Buys short, sharp dips: when a short-period RSI falls below the buy level, and sells when it bounces above the sell level. A classic, frequent mean-reversion setup for liquid ETFs.",
  params,
  timeframes: ALL_TIMEFRAMES,
  defaultTimeframe: "15m",
  defaultSymbols: ["SPY", "QQQ", "IWM", "DIA", "XLF", "XLK", "XLE", "XLV"],
  warmup: (p) => p.period * 10 + 10,
  decide({ bars, position, params: p }): Signal {
    const r = round(
      last(
        rsi(
          bars.map((b) => b.c),
          p.period,
        ),
      ),
      1,
    );
    const label = `RSI(${p.period}) ${r}`;
    if (!position) {
      if (r < p.buyBelow)
        return {
          action: "buy",
          reason: `${label} dropped below ${p.buyBelow}`,
          values: { rsi: r },
        };
      return {
        action: "hold",
        reason: `${label}, buys below ${p.buyBelow}`,
        values: { rsi: r, distance: round(r - p.buyBelow, 2) },
      };
    }
    if (r > p.sellAbove)
      return { action: "sell", reason: `${label} rose above ${p.sellAbove}`, values: { rsi: r } };
    return {
      action: "hold",
      reason: `Holding: ${label}, sells above ${p.sellAbove}`,
      values: { rsi: r },
    };
  },
};
