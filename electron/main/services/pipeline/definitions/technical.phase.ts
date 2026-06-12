import type { WorkerDefinition } from "@electron/shared/ai/ai-phase";
import { ENGINE_BINDINGS } from "@electron/shared/ai/ai-phase-config";
import {
  technicalSignalSchema,
  type TechnicalSignal,
} from "@electron/shared/ai/trade-signals";
// Self-registers the technical-aggregator finalizer engine when this module loads.
import "../engines/finalizer/technical-aggregator";
import { resolvePipelinePhaseWorkers } from "../pipeline-phase-worker-resolver";
import {
  momentumOutputSchema,
  volumeOutputSchema,
} from "../../signal/aggregators/technical-aggregator";
import type { AIPhase } from "../phases/types";
import {
  TECHNICAL_WORKERS_PRICE_REACTION_CHECKER_PROMPT,
  TECHNICAL_WORKERS_VOLUME_PROFILE_PROMPT,
} from "../worker-prompts";
import type { AggregatorPlanState } from "./aggregator.types";

export type { AggregatorPlanState };

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

export const CATALYST_TECHNICAL_WORKERS: readonly WorkerDefinition[] = [
  {
    id: "price-reaction-checker",
    prompt: TECHNICAL_WORKERS_PRICE_REACTION_CHECKER_PROMPT,
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

export const TECHNICAL_PHASE: AIPhase<AggregatorPlanState, TechnicalSignal> = {
  phase: "technical",
  outputSchemaName: "technicalSignal",
  persistAggregate: false,
  catalog: {
    outputMode: "object",
    outputSchema: technicalSignalSchema,
    engines: [ENGINE_BINDINGS.technicalAggregatorFinalize],
  },
  finalizeEngineIds: ["technical-aggregator"],
  initialState: (): AggregatorPlanState => ({}),
  stages: [
    {
      id: "workers",
      frontier: 0,
      resolveWorkers(ctx) {
        return [...resolvePipelinePhaseWorkers(ctx.pipelineId, "technical")];
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
