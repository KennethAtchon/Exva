import { z } from "zod";
import type { StrategyDefinition } from "../strategy-definition-registry";

const parameterSchema = z.object({});

type Parameters = z.infer<typeof parameterSchema>;

export const optionsFlowDefinition: StrategyDefinition<Parameters> = {
  id: "options-flow",
  parameterSchemaVersion: 1,
  parameterSchema,
  acceptedInstrumentClasses: ["stock"] as const,
  supportedTimeframes: ["1h", "4h", "1d"] as const,
  minimumCadenceMs: 15 * 60 * 1000,
  requiredBarCount: 0,
  implementationStatus: "disabled",
  implementationVersion: 0,
  create(_parameters: Parameters) {
    throw new Error(
      `Strategy "options-flow" is disabled; options chain volume/OI data not yet wired`,
    );
  },
};
