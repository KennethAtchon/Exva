import { z } from "zod";
import {
  BREAKOUT_DEFAULT_LOOKBACK,
  createBreakoutStrategy,
} from "../../signals/strategy/breakout-signal";
import type { StrategyDefinition } from "../strategy-definition-registry";

const parameterSchema = z.object({
  lookback: z.number().int().positive().default(BREAKOUT_DEFAULT_LOOKBACK),
  volumeMultiplierThreshold: z.number().default(1.5),
});

type Parameters = z.infer<typeof parameterSchema>;

export const breakoutDefinition: StrategyDefinition<Parameters> = {
  id: "breakout",
  parameterSchemaVersion: 1,
  parameterSchema,
  acceptedInstrumentClasses: ["crypto"] as const,
  supportedTimeframes: ["1h", "4h", "1d"] as const,
  minimumCadenceMs: 15 * 60 * 1000,
  requiredBarCount: 50,
  implementationStatus: "available",
  implementationVersion: 1,
  create(parameters: Parameters) {
    return createBreakoutStrategy({
      lookback: parameters.lookback,
      volumeMultiplierThreshold: parameters.volumeMultiplierThreshold,
    });
  },
};
