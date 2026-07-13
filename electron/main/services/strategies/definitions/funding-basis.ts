import { z } from "zod";
import { createMeanReversionStrategy } from "../../signals/strategy/mean-reversion-signal";
import type { StrategyDefinition } from "../strategy-definition-registry";

/**
 * Funding/basis scan is driven by funding_rates history, not OHLCV.
 * Registered available for the catalog; real emits via detectFundingDislocations.
 */
const parameterSchema = z.object({
  extremePercentile: z.number().min(0.5).max(1).default(0.95),
  windowSize: z.number().int().positive().default(90),
});

type Parameters = z.infer<typeof parameterSchema>;

export const fundingBasisDefinition: StrategyDefinition<Parameters> = {
  id: "funding-basis",
  parameterSchemaVersion: 1,
  parameterSchema,
  acceptedInstrumentClasses: ["crypto"] as const,
  supportedTimeframes: ["1h", "4h", "1d"] as const,
  minimumCadenceMs: 60 * 60 * 1000,
  requiredBarCount: 0,
  implementationStatus: "available",
  implementationVersion: 1,
  create(parameters: Parameters) {
    void parameters;
    return createMeanReversionStrategy({
      id: "funding-basis",
      zScoreEntry: -999,
    });
  },
};
