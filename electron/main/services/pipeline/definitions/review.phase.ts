import type { PipelineDefinition } from "@electron/shared/ai/pipeline-phase";
import { ENGINE_BINDINGS } from "@electron/shared/ai/pipeline-config";
import {
  reviewSignalSchema,
  type ReviewSignal,
  type TechnicalSignal,
  type FundamentalSignal,
} from "@electron/shared/ai/pipeline-signals";
import {
  conflictDetectorOutputSchema,
  riskAssessorOutputSchema,
} from "../../signal/aggregators/review-aggregator";

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

export type ReviewPhaseInput = {
  instrumentSymbol: string;
  technical: TechnicalSignal;
  fundamental: FundamentalSignal;
};

const CONFLICT_DETECTOR_WORKER = {
  id: "conflict-detector",
  promptAssetPath: "review-workers/conflict-detector",
  tools: [] as const,
  engines: [ENGINE_BINDINGS.riskSummaryRead],
  strategyContext: REVIEW_STRATEGY_CONTEXT,
  outputMode: "tool_result" as const,
  outputSchema: conflictDetectorOutputSchema,
};

const RISK_ASSESSOR_WORKER = {
  id: "risk-assessor",
  promptAssetPath: "review-workers/risk-assessor",
  tools: [] as const,
  engines: [ENGINE_BINDINGS.riskSummaryRead],
  strategyContext: REVIEW_STRATEGY_CONTEXT,
  outputMode: "tool_result" as const,
  outputSchema: riskAssessorOutputSchema,
};

/** Registry metadata for review. Execution is driven by REVIEW_PLAN via PhasePlanInterpreter. */
export const REVIEW_PHASE: PipelineDefinition<ReviewPhaseInput, ReviewSignal> =
  {
    phase: "review",
    outputMode: "object",
    outputSchema: reviewSignalSchema as import("zod").ZodType<ReviewSignal>,
    workers: [CONFLICT_DETECTOR_WORKER, RISK_ASSESSOR_WORKER],
    engines: [ENGINE_BINDINGS.reviewAggregatorFinalize],
    persistence: {
      outputSchemaName: "reviewSignal",
      traceMode: "aggregate_workers",
    },
  };
