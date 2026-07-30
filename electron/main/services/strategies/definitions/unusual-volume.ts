import { z } from "zod";
import { createUnusualVolumeStrategy } from "../../signals/strategy/unusual-volume-signal";
import type { StrategyDefinition } from "../strategy-definition-registry";

const parameterSchema = z.object({
  rvolThreshold: z.number().positive().default(2.5),
  baselineBars: z.number().int().positive().default(20),
  priceBreakPct: z.number().nonnegative().default(0.005),
});

type Parameters = z.infer<typeof parameterSchema>;

export const unusualVolumeDefinition: StrategyDefinition<Parameters> = {
  id: "unusual-volume",
  dataDriver: "ohlcv",
  parameterSchemaVersion: 1,
  parameterSchema,
  acceptedInstrumentClasses: ["stock"] as const,
  supportedTimeframes: ["15m", "30m", "1h", "4h", "1d"] as const,
  minimumCadenceMs: 15 * 60 * 1000,
  requiredBarCount: 25,
  implementationStatus: "available",
  implementationVersion: 1,
  create(parameters: Parameters) {
    return createUnusualVolumeStrategy({
      rvolThreshold: parameters.rvolThreshold,
      baselineBars: parameters.baselineBars,
      priceBreakPct: parameters.priceBreakPct,
    });
  },
};
