import { z } from "zod";
import {
  computeOptionsFlowSignal,
  optionsFlowInputSchema,
} from "../../signals/strategy/options-flow-signal";
import type { DeterministicStrategy } from "../../backtest/replay-engine";
import type { StrategyDefinition } from "../strategy-definition-registry";
import type { OhlcvBar } from "../../broker/adapters/broker-adapter";

const parameterSchema = z.object({
  volumeOiRatioThreshold: z.number().positive().default(2),
  bullishSkewThreshold: z.number().min(0.5).max(1).default(0.6),
  /** Prefer vertical spreads (v2) over underlying equity. */
  useVerticalSpreads: z.boolean().default(true),
  targetWidth: z.number().positive().default(5),
});

type Parameters = z.infer<typeof parameterSchema>;

/**
 * Options-flow v2: UOA detector → vertical spread selection via Tradier
 * placeSpread. Evidence class is forward-paper (historical chains out of reach).
 */
export const optionsFlowDefinition: StrategyDefinition<Parameters> = {
  id: "options-flow",
  parameterSchemaVersion: 2,
  parameterSchema,
  acceptedInstrumentClasses: ["stock", "options"] as const,
  supportedTimeframes: ["1h", "4h", "1d"] as const,
  minimumCadenceMs: 15 * 60 * 1000,
  requiredBarCount: 0,
  // Blocked until Solution 10 chain→OCC→order composition exists.
  // Bar-only evaluate() always returns null — not a runnable producer.
  implementationStatus: "disabled",
  implementationVersion: 2,
  create(parameters: Parameters) {
    return createOptionsFlowStrategy(parameters);
  },
};

function createOptionsFlowStrategy(
  parameters: Parameters,
): DeterministicStrategy {
  return {
    id: "options-flow",
    warmupBars: 0,
    evaluate(_bars: OhlcvBar[], ctx) {
      void parameters;
      void ctx;
      // Bar-only path cannot see option chains — skip. Live path uses
      // computeOptionsFlowSignal with chain volume inputs from the pipeline.
      return null;
    },
  };
}

export { computeOptionsFlowSignal, optionsFlowInputSchema };
