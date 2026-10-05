import { z } from "zod";
import { ALL_TIMEFRAMES, type Signal, type Strategy } from "./types.ts";

const params = z.object({
  holdBars: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(1)
    .meta({ title: "Hold for (bars)", description: "Sell after holding this many bars." }),
});

/** Test bot, not a strategy: buys, waits, sells, forever. Proves data → decision → order → fill → trade. */
export const heartbeat: Strategy<z.infer<typeof params>> = {
  id: "heartbeat",
  name: "Heartbeat (test)",
  description:
    "Buys, holds for a bar or two, sells, and repeats. It exists only to prove the whole pipeline works end to end. Excluded from performance comparisons.",
  params,
  timeframes: ALL_TIMEFRAMES,
  defaultTimeframe: "5m",
  defaultSymbols: ["BTC/USD"],
  isTest: true,
  warmup: () => 1,
  decide({ position, params: p, bars }): Signal {
    const price = bars[bars.length - 1]?.c ?? 0;
    if (!position)
      return {
        action: "buy",
        reason: "Heartbeat test: buying to prove the pipeline works",
        values: { price },
      };
    if (position.barsHeld >= p.holdBars) {
      return {
        action: "sell",
        reason: `Heartbeat test: held ${position.barsHeld} bar(s), selling`,
        values: { price },
      };
    }
    return {
      action: "hold",
      reason: `Heartbeat test: holding (${position.barsHeld}/${p.holdBars} bars)`,
      values: { price },
    };
  },
};
