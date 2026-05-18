import type { PipelineDefinition } from "@electron/shared/ai/pipeline-phase";

export type ReviewPhaseInput = {
  instrumentSymbol: string;
  technicalAnalysis: string;
  fundamentalAnalysis: string;
};

export type ReviewPhaseOutput = {
  text: string;
};

export const REVIEW_PHASE: PipelineDefinition<ReviewPhaseInput, ReviewPhaseOutput> = {
  phase: "review",
  outputMode: "text",
  workers: [
    {
      id: "reviewer",
      promptAssetPath: "review",
      tools: ["search_web"],
      outputMode: "text",
    },
  ],
  persistence: {
    outputSchemaName: null,
    traceMode: "single_phase_run",
  },
};
