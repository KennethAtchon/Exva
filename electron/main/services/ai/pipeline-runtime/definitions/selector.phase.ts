import type { PipelineDefinition } from "@electron/shared/ai/pipeline-phase";
import type { InstrumentSelection } from "@/lib/schemas";

export type SelectorPhaseInput = {
  selectionInstructions: string;
};

export const SELECTOR_PHASE: PipelineDefinition<SelectorPhaseInput, InstrumentSelection> = {
  phase: "selector",
  outputMode: "tool_terminal",
  terminalToolNames: ["submit_candidates"],
  workers: [
    {
      id: "instrument-selector",
      promptAssetPath: "electron/prompts/instrument_selector.md",
      tools: [
        "search_web",
        "fetch_url",
        "search_reddit",
        "get_trending_symbols",
        "get_quote",
        "get_ohlcv",
        "get_news",
        "submit_candidates",
      ],
      outputMode: "tool_terminal",
    },
  ],
  persistence: {
    outputSchemaName: "instrumentSelection",
    traceMode: "single_phase_run",
  },
};
