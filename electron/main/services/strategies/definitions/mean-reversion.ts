import { z } from "zod";
import { createMeanReversionStrategy } from "../../signals/strategy/mean-reversion-signal";
import type { StrategyDefinition } from "../strategy-definition-registry";

const parameterSchema = z.object({
  zScoreEntry: z.number().default(-2),
});

type Parameters = z.infer<typeof parameterSchema>;

export const meanReversionDefinition: StrategyDefinition<Parameters> = {
  id: "mean-reversion",
  dataDriver: "ohlcv",
  parameterSchemaVersion: 1,
  parameterSchema,
  acceptedInstrumentClasses: ["stock"] as const,
  supportedTimeframes: ["15m", "30m", "1h", "4h", "1d"] as const,
  minimumCadenceMs: 5 * 60 * 1000,
  requiredBarCount: 50,
  implementationStatus: "available",
  implementationVersion: 1,
  create(parameters: Parameters) {
    return createMeanReversionStrategy({ zScoreEntry: parameters.zScoreEntry });
  },
};
