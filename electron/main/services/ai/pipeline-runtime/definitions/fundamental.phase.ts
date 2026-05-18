import type { PipelineDefinition } from "@electron/shared/ai/pipeline-phase";
import { z } from "zod";

export type FundamentalPhaseInput = {
  instrumentSymbol: string;
  context?: string;
};

export type FundamentalPhaseOutput = {
  text: string;
};

const fundamentalPhaseOutputSchema = z.object({
  text: z.string(),
});

export const FUNDAMENTAL_PHASE: PipelineDefinition<FundamentalPhaseInput, FundamentalPhaseOutput> = {
  phase: "fundamental",
  outputMode: "object",
  outputSchema: fundamentalPhaseOutputSchema,
  workers: [
    {
      id: "analyst-fundamental",
      promptAssetPath: "fundamental",
      tools: ["search_web", "get_news"],
      outputMode: "object",
      outputSchema: fundamentalPhaseOutputSchema,
    },
  ],
  persistence: {
    outputSchemaName: "fundamentalAnalysis",
    traceMode: "single_phase_run",
  },
};
