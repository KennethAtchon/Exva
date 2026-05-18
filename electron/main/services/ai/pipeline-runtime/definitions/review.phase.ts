import type { PipelineDefinition } from "@electron/shared/ai/pipeline-phase";
import { z } from "zod";

export type ReviewPhaseInput = {
  instrumentSymbol: string;
  technicalAnalysis: string;
  fundamentalAnalysis: string;
};

export type ReviewPhaseOutput = {
  text: string;
};

const reviewPhaseOutputSchema = z.object({
  text: z.string(),
});

export const REVIEW_PHASE: PipelineDefinition<ReviewPhaseInput, ReviewPhaseOutput> = {
  phase: "review",
  outputMode: "object",
  outputSchema: reviewPhaseOutputSchema,
  workers: [
    {
      id: "reviewer",
      promptAssetPath: "review",
      tools: ["search_web"],
      outputMode: "object",
      outputSchema: reviewPhaseOutputSchema,
    },
  ],
  persistence: {
    outputSchemaName: "reviewAnalysis",
    traceMode: "single_phase_run",
  },
};
