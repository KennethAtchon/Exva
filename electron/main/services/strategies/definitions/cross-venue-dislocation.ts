import { z } from "zod";
import type { StrategyDefinition } from "../strategy-definition-registry";

/**
 * Cross-venue dislocation is a scheduled scan over approved match-table rows,
 * not a pure OHLCV strategy. We register a lightweight available strategy so
 * the input catalog / schedule coordinator can schedule it; the scan body lives
 * in `cross-venue-dislocation.ts` and is invoked by the scheduled executor /
 * Dev Panel fire path with live venue quotes.
 *
 * The create() returns a no-op bar strategy (never emits from OHLCV alone) —
 * real emits come from `runCrossVenueDislocationScan`.
 */
const parameterSchema = z.object({
  minNetDivergence: z.number().positive().default(0.05),
});

type Parameters = z.infer<typeof parameterSchema>;

export const crossVenueDislocationDefinition: StrategyDefinition<Parameters> = {
  id: "cross-venue-dislocation",
  parameterSchemaVersion: 1,
  parameterSchema,
  acceptedInstrumentClasses: ["prediction_market"] as const,
  supportedTimeframes: ["1h", "4h", "1d"] as const,
  minimumCadenceMs: 15 * 60 * 1000,
  requiredBarCount: 0,
  implementationStatus: "available",
  implementationVersion: 1,
  create(parameters: Parameters) {
    // Placeholder deterministic strategy so the registry is complete.
    // Cross-venue emits are produced by runCrossVenueDislocationScan with
    // live quotes + approved match table, not from OHLCV bars.
    void parameters;
    return {
      id: "cross-venue-dislocation",
      warmupBars: 0,
      evaluate: () => null,
    };
  },
};
