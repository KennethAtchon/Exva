import { z } from "zod";
import {
  TREND_FOLLOWING_DEFAULT_LOOKBACK,
  createTrendFollowingStrategy,
} from "../../signals/strategy/trend-following-signal";
import type { StrategyDefinition } from "../strategy-definition-registry";

const parameterSchema = z.object({
  lookback: z
    .number()
    .int()
    .positive()
    .default(TREND_FOLLOWING_DEFAULT_LOOKBACK),
});

type Parameters = z.infer<typeof parameterSchema>;

export const trendFollowingDefinition: StrategyDefinition<Parameters> = {
  id: "trend-following",
  parameterSchemaVersion: 1,
  parameterSchema,
  acceptedInstrumentClasses: ["futures"] as const,
  supportedTimeframes: ["1h", "4h", "1d"] as const,
  minimumCadenceMs: 15 * 60 * 1000,
  requiredBarCount: 50,
  implementationStatus: "available",
  implementationVersion: 1,
  create(parameters: Parameters) {
    return createTrendFollowingStrategy({ lookback: parameters.lookback });
  },
};
