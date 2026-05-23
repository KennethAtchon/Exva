import type { PipelineDefinition } from "@electron/shared/ai/ai-phase";
import type { InstrumentSelection } from "@/lib/schemas";
import { selectorDiscoveryWorkersForMode } from "../pipeline-discovery-config";

export type SelectorPhaseInput = {
  selectionInstructions?: string;
};

/** Registry metadata for selector. Execution is driven by SELECTOR_PLAN via AIPhaseRunner. */
export const SELECTOR_PHASE: PipelineDefinition<
  SelectorPhaseInput,
  InstrumentSelection
> = {
  phase: "selector",
  outputMode: "tool_terminal",
  workers: selectorDiscoveryWorkersForMode("trend_scan"),
  persistence: {
    outputSchemaName: "instrumentSelection",
    traceMode: "aggregate_workers",
  },
};
