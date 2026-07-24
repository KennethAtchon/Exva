import { z } from "zod";
import { createNyRangeBreakoutStrategy } from "../../signals/strategy/ny-range-breakout-signal";
import type { StrategyDefinition } from "../strategy-definition-registry";

const parameterSchema = z.object({
  pipSize: z.number().positive().default(0.1),
  stopBufferPips: z.number().positive().default(10),
  targetPips: z.number().positive().default(20),
  sessionEndHourNy: z.number().int().min(2).max(23).default(23),
});

type Parameters = z.infer<typeof parameterSchema>;

export const nyRangeBreakoutDefinition: StrategyDefinition<Parameters> = {
  id: "ny-range-breakout",
  parameterSchemaVersion: 1,
  parameterSchema,
  acceptedInstrumentClasses: ["futures"] as const,
  supportedTimeframes: ["5m"] as const,
  minimumCadenceMs: 5 * 60 * 1000,
  requiredBarCount: 289,
  implementationStatus: "available",
  implementationVersion: 1,
  create(parameters: Parameters) {
    return createNyRangeBreakoutStrategy(parameters);
  },
};
