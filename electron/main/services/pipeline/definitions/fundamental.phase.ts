import type { WorkerDefinition } from "@electron/shared/ai/ai-phase";
import { ENGINE_BINDINGS } from "@electron/shared/ai/ai-phase-config";
import {
  fundamentalSignalSchema,
  type FundamentalSignal,
} from "@electron/shared/ai/trade-signals";
// Self-registers the fundamental-aggregator finalizer engine when this module loads.
import "../engines/finalizer/fundamental-aggregator";
import type { ResearchDiscoveryMode } from "@electron/shared/domain";
import { BUILT_IN_DUCKDUCKGO_PROVIDER_ID } from "@electron/shared/instruments/search-providers";
import {
  catalystOutputSchema,
  earningsOutputSchema,
  sentimentOutputSchema,
} from "../../signal/aggregators/fundamental-aggregator";
import type { AIPhase } from "../phases/types";
import {
  FUNDAMENTAL_WORKERS_CATALYST_CONTEXT_PROMPT,
  FUNDAMENTAL_WORKERS_EARNINGS_CONTEXT_PROMPT,
  FUNDAMENTAL_WORKERS_EVENT_CATALYST_PROMPT,
  FUNDAMENTAL_WORKERS_EVENT_RESOLUTION_PROMPT,
  FUNDAMENTAL_WORKERS_EVENT_SENTIMENT_PROMPT,
  FUNDAMENTAL_WORKERS_SENTIMENT_CONTEXT_PROMPT,
} from "../worker-prompts";
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

const STANDARD_FUNDAMENTAL_WORKERS: readonly WorkerDefinition[] = [
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
  {
    id: "sentiment-context",
    prompt: FUNDAMENTAL_WORKERS_SENTIMENT_CONTEXT_PROMPT,
    tools: ["search_web"],
    toolConfig: SEARCH_WEB_TOOL_CONFIG,
    strategyContext: FUNDAMENTAL_STRATEGY_CONTEXT,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "tool_result",
    outputSchema: sentimentOutputSchema,
  },
];

const EVENT_FUNDAMENTAL_WORKERS: readonly WorkerDefinition[] = [
  {
    id: "resolution-context",
    prompt: FUNDAMENTAL_WORKERS_EVENT_RESOLUTION_PROMPT,
    tools: ["search_web"],
    toolConfig: SEARCH_WEB_TOOL_CONFIG,
    strategyContext: FUNDAMENTAL_STRATEGY_CONTEXT,
    outputMode: "tool_result",
    outputSchema: earningsOutputSchema,
  },
  {
    id: "event-catalyst",
    prompt: FUNDAMENTAL_WORKERS_EVENT_CATALYST_PROMPT,
    tools: ["search_web", "fetch_url"],
    toolConfig: SEARCH_WEB_TOOL_CONFIG,
    strategyContext: FUNDAMENTAL_STRATEGY_CONTEXT,
    outputMode: "tool_result",
    outputSchema: catalystOutputSchema,
  },
  {
    id: "event-sentiment",
    prompt: FUNDAMENTAL_WORKERS_EVENT_SENTIMENT_PROMPT,
    tools: ["search_web"],
    toolConfig: SEARCH_WEB_TOOL_CONFIG,
    strategyContext: FUNDAMENTAL_STRATEGY_CONTEXT,
    outputMode: "tool_result",
    outputSchema: sentimentOutputSchema,
  },
];

function fundamentalWorkersForMode(
  discoveryMode: ResearchDiscoveryMode,
): readonly WorkerDefinition[] {
  return discoveryMode === "event_contract_scan"
    ? EVENT_FUNDAMENTAL_WORKERS
    : STANDARD_FUNDAMENTAL_WORKERS;
}

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
  resolveWorkersForMode: fundamentalWorkersForMode,
  finalizeEngineIds: ["fundamental-aggregator"],
  initialState: (): AggregatorPlanState => ({}),
  stages: [
    {
      id: "workers",
      frontier: 0,
      resolveWorkers(ctx) {
        return [
          ...fundamentalWorkersForMode(
            ctx.strategyContext.researchPosture.discoveryMode,
          ),
        ];
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
