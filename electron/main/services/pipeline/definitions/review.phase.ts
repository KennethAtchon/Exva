import type { WorkerDefinition } from "@electron/shared/ai/ai-phase";
import { ENGINE_BINDINGS } from "@electron/shared/ai/ai-phase-config";
import {
  type ReviewSignal,
  type TechnicalSignal,
  type FundamentalSignal,
} from "@electron/shared/ai/trade-signals";
import { signalForWorkerPrompt } from "@electron/shared/ai/worker-prompt-payload";
import {
  conflictDetectorOutputSchema,
  riskAssessorOutputSchema,
} from "../../signal/aggregators/review-aggregator";
import type { AIPhase } from "../phases/types";
import {
  REVIEW_WORKERS_CONFLICT_DETECTOR_PROMPT,
  REVIEW_WORKERS_RISK_ASSESSOR_PROMPT,
} from "../worker-prompts";
import type { AggregatorPlanState } from "./aggregator.types";

export type { AggregatorPlanState };

export type ReviewPhaseInput = {
  instrumentSymbol: string;
  technical: TechnicalSignal;
  fundamental: FundamentalSignal;
};

const REVIEW_STRATEGY_CONTEXT = {
  fields: [
    "identity",
    "researchPosture",
    "riskLimits",
    "timeframe",
    "presetBehavior",
  ],
  guidance: ["objective", "howToEvaluate", "avoid"],
  maxGuidanceItems: 2,
} as const;

export const REVIEW_WORKERS: readonly WorkerDefinition[] = [
  {
    id: "conflict-detector",
    prompt: REVIEW_WORKERS_CONFLICT_DETECTOR_PROMPT,
    tools: [],
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    strategyContext: REVIEW_STRATEGY_CONTEXT,
    outputMode: "tool_result",
    outputSchema: conflictDetectorOutputSchema,
  },
  {
    id: "risk-assessor",
    prompt: REVIEW_WORKERS_RISK_ASSESSOR_PROMPT,
    tools: [],
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    strategyContext: REVIEW_STRATEGY_CONTEXT,
    outputMode: "tool_result",
    outputSchema: riskAssessorOutputSchema,
  },
];

export const REVIEW_PHASE: AIPhase<AggregatorPlanState, ReviewSignal> = {
  phase: "review",
  outputSchemaName: "reviewSignal",
  persistAggregate: false,
  finalizeEngineIds: ["review-aggregator"],
  initialState: (): AggregatorPlanState => ({}),
  stages: [
    {
      id: "workers",
      frontier: 0,
      resolveWorkers: () => [...REVIEW_WORKERS],
      buildTask(ctx) {
        return {
          instrumentSymbol: ctx.input.instrumentSymbol,
          technicalSignal: JSON.stringify(
            signalForWorkerPrompt(ctx.input.technical as TechnicalSignal),
          ),
          fundamentalSignal: JSON.stringify(
            signalForWorkerPrompt(ctx.input.fundamental as FundamentalSignal),
          ),
        };
      },
      concurrency: 2,
      toleratePartialFailure: false,
      applyResults(_ctx, state) {
        // Worker results flow through the FinalizerEngine.run workerResults param.
        // No accumulation needed in state.
        return state;
      },
    },
  ],
};
