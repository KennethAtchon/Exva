import type { PipelineDefinition } from "@electron/shared/ai/pipeline-phase";
import { tradeDecisionSchema } from "@/lib/schemas";
import type { TradeDecision } from "../../../ai/ai-runtime/runtime";

export type DecisionPhaseInput = {
  instrumentSymbol: string;
  technicalAnalysis: string;
  fundamentalAnalysis: string;
  review: string;
  maxPositionUsd: number;
};

export const DECISION_PHASE: PipelineDefinition<DecisionPhaseInput, TradeDecision> = {
  phase: "decision",
  outputMode: "object",
  outputSchema: tradeDecisionSchema,
  workers: [
    {
      id: "decision-maker",
      promptAssetPath: "decision",
      tools: [],
      outputMode: "object",
      outputSchema: tradeDecisionSchema,
    },
  ],
  persistence: {
    outputSchemaName: "tradeDecision",
    traceMode: "single_phase_run",
  },
};
