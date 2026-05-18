import type { PipelineDefinition } from "@electron/shared/ai/pipeline-phase";
import type { InstrumentSelection } from "@/lib/schemas";
import { buildSelectorPrepareStep, defaultSelectorRuntimeSettings } from "../../ai-runtime/selector-runtime-control";
import type { ToolBuildContext } from "../context/tool-factory-registry";

export type SelectorPhaseInput = {
  selectionInstructions: string;
};

export const SELECTOR_PHASE: PipelineDefinition<SelectorPhaseInput, InstrumentSelection> = {
  phase: "selector",
  outputMode: "tool_terminal",
  terminalToolNames: ["submit_candidates"],
  buildPrepareStep: (ctx: unknown) => {
    const toolCtx = ctx as ToolBuildContext;
    const hasBrokerWiring = Boolean(toolCtx.brokerRouting && toolCtx.brokerRegistry);
    const availability = {
      searchWeb: Boolean(toolCtx.searchProviderId),
      fetchUrl: true,
      searchReddit: true,
      trendingSymbols: true,
      getNews: hasBrokerWiring && (Boolean(toolCtx.searchProviderId) || Boolean(toolCtx.mockNewsData)),
      getQuote: hasBrokerWiring,
      getOhlcv: hasBrokerWiring,
      submitCandidates: true,
    };
    return buildSelectorPrepareStep(availability, defaultSelectorRuntimeSettings());
  },
  workers: [
    {
      id: "instrument-selector",
      promptAssetPath: "selector",
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
