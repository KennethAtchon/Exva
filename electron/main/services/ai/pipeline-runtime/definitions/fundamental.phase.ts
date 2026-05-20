import type { PipelineDefinition } from "@electron/shared/ai/pipeline-phase";
import { ENGINE_BINDINGS } from "@electron/shared/ai/pipeline-config";
import {
  fundamentalSignalSchema,
  type FundamentalSignal,
} from "@electron/shared/ai/pipeline-signals";
import { fundamentalWorkersForMode } from "../pipeline-discovery-config";

export type FundamentalPhaseInput = {
  instrumentSymbol: string;
  selectorEvidence?:
    | import("@electron/shared/ai/selector-pipeline-candidate").SelectorEvidence
    | null;
};

/** Registry metadata for fundamental. Execution is driven by FUNDAMENTAL_PLAN via PhasePlanInterpreter. */
export const FUNDAMENTAL_PHASE: PipelineDefinition<
  FundamentalPhaseInput,
  FundamentalSignal
> = {
  phase: "fundamental",
  outputMode: "object",
  outputSchema:
    fundamentalSignalSchema as import("zod").ZodType<FundamentalSignal>,
  workers: fundamentalWorkersForMode("trend_scan"),
  engines: [ENGINE_BINDINGS.fundamentalAggregatorFinalize],
  persistence: {
    outputSchemaName: "fundamentalSignal",
    traceMode: "aggregate_workers",
  },
};
