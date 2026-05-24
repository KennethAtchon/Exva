import type { WorkerDefinition } from "@electron/shared/ai/ai-phase";
import { ENGINE_BINDINGS } from "@electron/shared/ai/ai-phase-config";
import type { TechnicalSignal } from "@electron/shared/ai/trade-signals";
import type { ResearchDiscoveryMode } from "@electron/shared/domain";
import type { LLMRunResult } from "../../llm/llm-types";
import {
  chartPatternOutputSchema,
  momentumOutputSchema,
  volumeOutputSchema,
} from "../../signal/aggregators/technical-aggregator";
import type { AIPhase } from "../phases/types";
import {
  TECHNICAL_WORKERS_CHART_PATTERN_PROMPT,
  TECHNICAL_WORKERS_EVENT_IMPLIED_PROBABILITY_PROMPT,
  TECHNICAL_WORKERS_EVENT_LIQUIDITY_PROMPT,
  TECHNICAL_WORKERS_EVENT_PRICE_DRIFT_PROMPT,
  TECHNICAL_WORKERS_MOMENTUM_INDICATOR_PROMPT,
  TECHNICAL_WORKERS_VOLUME_PROFILE_PROMPT,
} from "../worker-prompts";

type WorkerResult = { worker: WorkerDefinition; result: LLMRunResult<unknown> };

export type AggregatorPlanState = {
  workers: readonly WorkerDefinition[];
  workerResults: WorkerResult[];
};

export type TechnicalPhaseInput = {
  instrumentSymbol: string;
  selectorEvidence?:
    | import("@electron/shared/ai/selector-candidate").SelectorEvidence
    | null;
};

const TECHNICAL_STRATEGY_CONTEXT = {
  fields: [
    "identity",
    "tradeRules",
    "riskLimits",
    "timeframe",
    "presetBehavior",
  ],
  guidance: ["objective", "whatToLookFor", "howToEvaluate", "avoid"],
  maxGuidanceItems: 2,
} as const;

const STANDARD_TECHNICAL_WORKERS: readonly WorkerDefinition[] = [
  {
    id: "chart-pattern",
    prompt: TECHNICAL_WORKERS_CHART_PATTERN_PROMPT,
    tools: ["get_ohlcv"],
    strategyContext: TECHNICAL_STRATEGY_CONTEXT,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "tool_result",
    outputSchema: chartPatternOutputSchema,
  },
  {
    id: "momentum-indicator",
    prompt: TECHNICAL_WORKERS_MOMENTUM_INDICATOR_PROMPT,
    tools: ["get_ohlcv", "get_quote"],
    strategyContext: TECHNICAL_STRATEGY_CONTEXT,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "tool_result",
    outputSchema: momentumOutputSchema,
  },
  {
    id: "volume-profile",
    prompt: TECHNICAL_WORKERS_VOLUME_PROFILE_PROMPT,
    tools: ["get_ohlcv"],
    strategyContext: TECHNICAL_STRATEGY_CONTEXT,
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    outputMode: "tool_result",
    outputSchema: volumeOutputSchema,
  },
];

const EVENT_TECHNICAL_WORKERS: readonly WorkerDefinition[] = [
  {
    id: "implied-probability",
    prompt: TECHNICAL_WORKERS_EVENT_IMPLIED_PROBABILITY_PROMPT,
    tools: ["get_quote", "get_ohlcv"],
    strategyContext: TECHNICAL_STRATEGY_CONTEXT,
    outputMode: "tool_result",
    outputSchema: chartPatternOutputSchema,
  },
  {
    id: "price-drift",
    prompt: TECHNICAL_WORKERS_EVENT_PRICE_DRIFT_PROMPT,
    tools: ["get_ohlcv", "get_quote"],
    strategyContext: TECHNICAL_STRATEGY_CONTEXT,
    outputMode: "tool_result",
    outputSchema: momentumOutputSchema,
  },
  {
    id: "event-liquidity",
    prompt: TECHNICAL_WORKERS_EVENT_LIQUIDITY_PROMPT,
    tools: ["get_ohlcv", "get_quote"],
    strategyContext: TECHNICAL_STRATEGY_CONTEXT,
    outputMode: "tool_result",
    outputSchema: volumeOutputSchema,
  },
];

function isEventContractScan(discoveryMode: ResearchDiscoveryMode): boolean {
  return discoveryMode === "event_contract_scan";
}

export function technicalWorkersForMode(
  discoveryMode: ResearchDiscoveryMode,
): readonly WorkerDefinition[] {
  return isEventContractScan(discoveryMode)
    ? EVENT_TECHNICAL_WORKERS
    : STANDARD_TECHNICAL_WORKERS;
}

export const TECHNICAL_PHASE: AIPhase<AggregatorPlanState, TechnicalSignal> = {
  phase: "technical",
  persistAggregate: false,
  finalizeEngineIds: ["technical-aggregator"],
  initialState: () => ({ workers: [], workerResults: [] }),
  stages: [
    {
      id: "workers",
      frontier: 0,
      resolveWorkers(ctx) {
        return [
          ...technicalWorkersForMode(
            ctx.strategyContext.researchPosture.discoveryMode,
          ),
        ];
      },
      buildTask(ctx) {
        return {
          instrumentSymbol: ctx.input.instrumentSymbol,
          selectorEvidence: ctx.input.selectorEvidence ?? null,
        };
      },
      concurrency: 3,
      toleratePartialFailure: false,
      applyResults(ctx, _state, results) {
        return {
          workers: technicalWorkersForMode(
            ctx.strategyContext.researchPosture.discoveryMode,
          ),
          workerResults: results,
        };
      },
    },
  ],
};
