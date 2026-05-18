import type { PipelineDefinition } from "@electron/shared/ai/pipeline-phase";
import { z } from "zod";

export type TechnicalPhaseInput = {
  instrumentSymbol: string;
  context?: string;
};

export type TechnicalPhaseOutput = {
  text: string;
};

const technicalPhaseOutputSchema = z.object({
  text: z.string(),
});

export const TECHNICAL_PHASE: PipelineDefinition<TechnicalPhaseInput, TechnicalPhaseOutput> = {
  phase: "technical",
  outputMode: "object",
  outputSchema: technicalPhaseOutputSchema,
  workers: [
    {
      id: "analyst-technical",
      promptAssetPath: "technical",
      tools: ["search_web", "fetch_url", "get_news"],
      outputMode: "object",
      outputSchema: technicalPhaseOutputSchema,
    },
  ],
  persistence: {
    outputSchemaName: "technicalAnalysis",
    traceMode: "single_phase_run",
  },
};
