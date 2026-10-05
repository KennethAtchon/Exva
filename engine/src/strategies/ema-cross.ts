import { z } from "zod";
import { fmtNum, round } from "../util.ts";
import { ema, last } from "./indicators.ts";
import { ALL_TIMEFRAMES, type Signal, type Strategy } from "./types.ts";

const params = z
  .object({
    fast: z
      .number()
      .int()
      .min(2)
      .max(200)
      .default(9)
      .meta({ title: "Fast EMA", description: "Bars in the fast average." }),
    slow: z
      .number()
      .int()
      .min(3)
      .max(400)
      .default(21)
      .meta({ title: "Slow EMA", description: "Bars in the slow average." }),
  })
  .refine((p) => p.fast < p.slow, { message: "Fast EMA must be shorter than slow EMA" });

export const emaCross: Strategy<z.infer<typeof params>> = {
  id: "ema-cross",
  name: "EMA Crossover",
  description:
    "Buys when the fast moving average crosses above the slow one and sells when it crosses back below. Trades several times a day on 15-minute crypto bars.",
  params,
  timeframes: ALL_TIMEFRAMES,
  defaultTimeframe: "15m",
  defaultSymbols: ["BTC/USD", "ETH/USD", "SOL/USD"],
  warmup: (p) => p.slow * 3,
  decide({ bars, position, params: p }): Signal {
    const closes = bars.map((b) => b.c);
    const f = ema(closes, p.fast);
    const s = ema(closes, p.slow);
    const [fNow, sNow, fPrev, sPrev] = [last(f), last(s), last(f, 1), last(s, 1)];
    const gapPct = ((fNow - sNow) / sNow) * 100;
    const values = { fastEma: round(fNow, 4), slowEma: round(sNow, 4), gapPct: round(gapPct, 3) };
    const names = `EMA${p.fast} ${fmtNum(fNow)} vs EMA${p.slow} ${fmtNum(sNow)}`;
    if (!position) {
      if (fPrev <= sPrev && fNow > sNow) {
        return {
          action: "buy",
          reason: `EMA${p.fast} crossed above EMA${p.slow} (${names})`,
          values,
        };
      }
      if (fNow < sNow) {
        return {
          action: "hold",
          reason: `${names}: fast is ${Math.abs(round(gapPct, 2))}% below slow, buys on a cross above`,
          values: { ...values, distance: Math.abs(round(gapPct, 3)) },
        };
      }
      return {
        action: "hold",
        reason: `${names}: already above, waiting for a fresh cross`,
        values,
      };
    }
    if (fPrev >= sPrev && fNow < sNow) {
      return {
        action: "sell",
        reason: `EMA${p.fast} crossed below EMA${p.slow} (${names})`,
        values,
      };
    }
    return { action: "hold", reason: `Holding: ${names}, sells on a cross below`, values };
  },
};
