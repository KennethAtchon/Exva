import type { PipelineDefinition } from "@electron/shared/ai/pipeline-phase";

export type TechnicalPhaseInput = {
  instrumentSymbol: string;
  context?: string;
};

export type TechnicalPhaseOutput = {
  text: string;
};

export const TECHNICAL_PHASE: PipelineDefinition<TechnicalPhaseInput, TechnicalPhaseOutput> = {
  phase: "technical",
  outputMode: "text",
  workers: [
    {
      id: "analyst-technical",
      promptAssetPath: "electron/prompts/analyst_technical.md",
      tools: ["search_web", "fetch_url", "get_news"],
      outputMode: "text",
    },
  ],
  persistence: {
    outputSchemaName: null,
    traceMode: "single_phase_run",
  },
};
