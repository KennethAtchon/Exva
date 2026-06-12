import type { WorkerDefinition } from "@electron/shared/ai/ai-phase";
import { ENGINE_BINDINGS } from "@electron/shared/ai/ai-phase-config";
import {
  fundamentalSignalSchema,
  type FundamentalSignal,
} from "@electron/shared/ai/trade-signals";
// Self-registers the fundamental-aggregator finalizer engine when this module loads.
import "../engines/finalizer/fundamental-aggregator";
import { resolvePipelinePhaseWorkers } from "../pipeline-phase-worker-resolver";
import { BUILT_IN_DUCKDUCKGO_PROVIDER_ID } from "@electron/shared/instruments/search-providers";
import {
  catalystOutputSchema,
  earningsOutputSchema,
} from "../../signal/aggregators/fundamental-aggregator";
import type { AIPhase } from "../phases/types";
import {
  FUNDAMENTAL_WORKERS_CATALYST_CONTEXT_PROMPT,
  FUNDAMENTAL_WORKERS_EARNINGS_CONTEXT_PROMPT,
  FUNDAMENTAL_WORKERS_DOCUMENT_EXTRACTOR_PROMPT,
  FUNDAMENTAL_WORKERS_MARKET_REACTION_CHECKER_PROMPT,
  CATALYST_ANALYST_PROMPT,
} from "../worker-prompts";
import { catalystAnalystOutputSchema } from "../../signal/aggregators/catalyst-two-call-aggregator";
import type { AggregatorPlanState } from "./aggregator.types";

export type { AggregatorPlanState };

const SEARCH_WEB_TOOL_CONFIG = {
  search_web: { fallbackProviderId: BUILT_IN_DUCKDUCKGO_PROVIDER_ID },
} as const;

const FUNDAMENTAL_STRATEGY_CONTEXT = {
  fields: ["identity", "researchPosture", "timeframe", "presetBehavior"],
  guidance: ["objective", "whatToLookFor", "howToEvaluate", "avoid"],
  maxGuidanceItems: 2,
} as const;

export const CATALYST_ANALYST_WORKER: WorkerDefinition = {
  id: "catalyst-analyst",
  prompt: CATALYST_ANALYST_PROMPT,
  tools: ["fetch_url", "search_web", "get_quote", "get_ohlcv"],
  toolConfig: SEARCH_WEB_TOOL_CONFIG,
  strategyContext: FUNDAMENTAL_STRATEGY_CONTEXT,
  engines: [ENGINE_BINDINGS.riskSummaryRead],
  outputMode: "tool_result",
  outputSchema: catalystAnalystOutputSchema,
};

export const CATALYST_FUNDAMENTAL_WORKERS: readonly WorkerDefinition[] = [
  {
    id: "document-extractor",
    prompt: FUNDAMENTAL_WORKERS_DOCUMENT_EXTRACTOR_PROMPT,
    tools: ["fetch_url", "search_web"],
    toolConfig: SEARCH_WEB_TOOL_CONFIG,
    strategyContext: FUNDAMENTAL_STRATEGY_CONTEXT,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "tool_result",
    outputSchema: catalystOutputSchema,
  },
  {
    id: "market-reaction-checker",
    prompt: FUNDAMENTAL_WORKERS_MARKET_REACTION_CHECKER_PROMPT,
    tools: ["get_quote", "get_ohlcv"],
    toolConfig: SEARCH_WEB_TOOL_CONFIG,
    strategyContext: FUNDAMENTAL_STRATEGY_CONTEXT,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "tool_result",
    outputSchema: earningsOutputSchema,
  },
];

export const STANDARD_FUNDAMENTAL_WORKERS: readonly WorkerDefinition[] = [
  {
    id: "earnings-context",
    prompt: FUNDAMENTAL_WORKERS_EARNINGS_CONTEXT_PROMPT,
    tools: ["search_web"],
    toolConfig: SEARCH_WEB_TOOL_CONFIG,
    strategyContext: FUNDAMENTAL_STRATEGY_CONTEXT,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "tool_result",
    outputSchema: earningsOutputSchema,
  },
  {
    id: "catalyst-context",
    prompt: FUNDAMENTAL_WORKERS_CATALYST_CONTEXT_PROMPT,
    tools: ["search_web"],
    toolConfig: SEARCH_WEB_TOOL_CONFIG,
    strategyContext: FUNDAMENTAL_STRATEGY_CONTEXT,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "tool_result",
    outputSchema: catalystOutputSchema,
  },
];

export const FUNDAMENTAL_PHASE: AIPhase<
  AggregatorPlanState,
  FundamentalSignal
> = {
  phase: "fundamental",
  outputSchemaName: "fundamentalSignal",
  persistAggregate: false,
  catalog: {
    outputMode: "object",
    outputSchema: fundamentalSignalSchema,
    engines: [ENGINE_BINDINGS.fundamentalAggregatorFinalize],
  },
  finalizeEngineIds: ["fundamental-aggregator"],
  initialState: (): AggregatorPlanState => ({}),
  stages: [
    {
      id: "workers",
      frontier: 0,
      resolveWorkers(ctx) {
        return [...resolvePipelinePhaseWorkers(ctx.pipelineId, "fundamental")];
      },
      buildTask(ctx) {
        return {
          instrumentSymbol: ctx.input.instrumentSymbol,
          selectorEvidence: ctx.input.selectorEvidence ?? null,
          recentFailureHistory: ctx.input.recentFailureHistory ?? [],
        };
      },
      concurrency: 3,
      toleratePartialFailure: false,
      applyResults(_ctx, state) {
        // Worker results flow through the FinalizerEngine.run workerResults param.
        // No accumulation needed in state.
        return state;
      },
    },
  ],
};
