import { z } from "zod";
import type { StrategyDefinition } from "../strategy-definition-registry";

/**
 * Form 4 insider-cluster scan over ingested form4_transactions.
 * Registered available; emits via scanForm4Clusters.
 */
const parameterSchema = z.object({
  minInsiders: z.number().int().positive().default(2),
  minTotalValueUsd: z.number().nonnegative().default(100_000),
  windowDays: z.number().int().positive().default(7),
});

type Parameters = z.infer<typeof parameterSchema>;

export const form4InsiderClusterDefinition: StrategyDefinition<Parameters> = {
  id: "form4-insider-cluster",
  parameterSchemaVersion: 1,
  parameterSchema,
  acceptedInstrumentClasses: ["stock"] as const,
  supportedTimeframes: ["1d"] as const,
  minimumCadenceMs: 60 * 60 * 1000,
  requiredBarCount: 0,
  implementationStatus: "available",
  implementationVersion: 1,
  create(parameters: Parameters) {
    void parameters;
    return {
      id: "form4-insider-cluster",
      warmupBars: 0,
      evaluate: () => null,
    };
  },
};
