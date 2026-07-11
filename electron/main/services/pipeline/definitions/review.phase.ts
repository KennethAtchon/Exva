import type { WorkerDefinition } from "@electron/shared/ai/ai-phase";
import { ENGINE_BINDINGS } from "@electron/shared/ai/ai-phase-config";
import {
  reviewSignalSchema,
  type ReviewSignal,
  type TechnicalSignal,
  type FundamentalSignal,
} from "@electron/shared/ai/trade-signals";
// Self-registers the review-aggregator finalizer engine when this module loads.
import "../engines/finalizer/review-aggregator";
import { signalForWorkerPrompt } from "@electron/shared/ai/worker-prompt-payload";
import {
  conflictDetectorOutputSchema,
  riskAssessorOutputSchema,
} from "../../signals/aggregators/review-aggregator";
import type { AIPhase } from "../phases/types";
import { resolvePipelinePhaseWorkers } from "../pipeline-phase-worker-resolver";
import {
  REVIEW_WORKERS_CONFLICT_DETECTOR_PROMPT,
  REVIEW_WORKERS_RISK_ASSESSOR_PROMPT,
  ADVERSARIAL_REVIEWER_PROMPT,
} from "../worker-prompts";
import { adversarialReviewerOutputSchema } from "../../signals/aggregators/catalyst-two-call-aggregator";
import type { AggregatorPlanState } from "./aggregator.types";

export type { AggregatorPlanState };

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

export const ADVERSARIAL_REVIEWER_WORKER: WorkerDefinition = {
  id: "adversarial-reviewer",
  prompt: ADVERSARIAL_REVIEWER_PROMPT,
  tools: [],
  engines: [ENGINE_BINDINGS.riskSummaryRead],
  strategyContext: REVIEW_STRATEGY_CONTEXT,
  outputMode: "tool_result",
  outputSchema: adversarialReviewerOutputSchema,
};

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
  catalog: {
    outputMode: "object",
    outputSchema: reviewSignalSchema,
    engines: [ENGINE_BINDINGS.reviewAggregatorFinalize],
  },
  finalizeEngineIds: ["review-aggregator"],
  initialState: (): AggregatorPlanState => ({}),
  stages: [
    {
      id: "workers",
      frontier: 0,
      resolveWorkers(ctx) {
        return [...resolvePipelinePhaseWorkers(ctx.pipelineId, "review")];
      },
      buildTask(ctx) {
        if (ctx.input.analystOutput) {
          return {
            instrumentSymbol: ctx.input.instrumentSymbol,
            analystOutput: ctx.input.analystOutput,
            recentFailureHistory: ctx.input.recentFailureHistory ?? [],
          };
        }
        return {
          instrumentSymbol: ctx.input.instrumentSymbol,
          technicalSignal: JSON.stringify(
            signalForWorkerPrompt(ctx.input.technical as TechnicalSignal),
          ),
          fundamentalSignal: JSON.stringify(
            signalForWorkerPrompt(ctx.input.fundamental as FundamentalSignal),
          ),
          recentFailureHistory: ctx.input.recentFailureHistory ?? [],
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
