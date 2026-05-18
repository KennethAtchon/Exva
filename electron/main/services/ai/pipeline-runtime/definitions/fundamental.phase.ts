import type { PipelineDefinition } from "@electron/shared/ai/pipeline-phase";

export type FundamentalPhaseInput = {
  instrumentSymbol: string;
  context?: string;
};

export type FundamentalPhaseOutput = {
  text: string;
};

export const FUNDAMENTAL_PHASE: PipelineDefinition<FundamentalPhaseInput, FundamentalPhaseOutput> = {
  phase: "fundamental",
  outputMode: "text",
  workers: [
    {
      id: "analyst-fundamental",
      promptAssetPath: "fundamental",
      tools: ["search_web", "get_news"],
      outputMode: "text",
    },
  ],
  persistence: {
    outputSchemaName: null,
    traceMode: "single_phase_run",
  },
};
