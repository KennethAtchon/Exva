import type { PipelineDefinition } from "@electron/shared/ai/ai-phase";
import { ENGINE_BINDINGS } from "@electron/shared/ai/ai-phase-config";
import {
  technicalSignalSchema,
  type TechnicalSignal,
} from "@electron/shared/ai/trade-signals";
import { technicalWorkersForMode } from "../pipeline-discovery-config";

export type TechnicalPhaseInput = {
  instrumentSymbol: string;
  selectorEvidence?:
    | import("@electron/shared/ai/selector-candidate").SelectorEvidence
    | null;
};

/** Registry metadata for technical. Execution is driven by TECHNICAL_PLAN via AIPhaseRunner. */
export const TECHNICAL_PHASE: PipelineDefinition<
  TechnicalPhaseInput,
  TechnicalSignal
> = {
  phase: "technical",
  outputMode: "object",
  outputSchema: technicalSignalSchema as import("zod").ZodType<TechnicalSignal>,
  workers: technicalWorkersForMode("trend_scan"),
  engines: [ENGINE_BINDINGS.technicalAggregatorFinalize],
  persistence: {
    outputSchemaName: "technicalSignal",
    traceMode: "aggregate_workers",
  },
};
