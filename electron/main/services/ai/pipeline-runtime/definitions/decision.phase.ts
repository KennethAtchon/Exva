import type { PipelineDefinition } from "@electron/shared/ai/pipeline-phase";
import { ENGINE_BINDINGS } from "@electron/shared/ai/pipeline-config";
import {
  tradeSignalSchema,
  type TradeSignal,
  type TechnicalSignal,
  type FundamentalSignal,
  type ReviewSignal,
} from "@electron/shared/ai/pipeline-signals";
import {
  entryTimerOutputSchema,
  signalClassifierOutputSchema,
} from "../../engines/aggregators/trade-signal-aggregator";

const DECISION_STRATEGY_CONTEXT = {
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

export type DecisionPhaseInput = {
  instrumentSymbol: string;
  technical: TechnicalSignal;
  fundamental: FundamentalSignal;
  review: ReviewSignal;
};

const SIGNAL_CLASSIFIER_WORKER = {
  id: "signal-classifier",
  promptAssetPath: "decision-workers/signal-classifier",
  tools: [] as const,
  engines: [ENGINE_BINDINGS.riskSummaryRead],
  strategyContext: DECISION_STRATEGY_CONTEXT,
  outputMode: "tool_result" as const,
  outputSchema: signalClassifierOutputSchema,
};

const ENTRY_TIMER_WORKER = {
  id: "entry-timer",
  promptAssetPath: "decision-workers/entry-timer",
  tools: [] as const,
  engines: [ENGINE_BINDINGS.riskSummaryRead],
  strategyContext: DECISION_STRATEGY_CONTEXT,
  outputMode: "tool_result" as const,
  outputSchema: entryTimerOutputSchema,
};

/** Registry metadata for decision. Execution is driven by DECISION_PLAN via PhasePlanInterpreter. */
export const DECISION_PHASE: PipelineDefinition<
  DecisionPhaseInput,
  TradeSignal
> = {
  phase: "decision",
  outputMode: "object",
  outputSchema: tradeSignalSchema as import("zod").ZodType<TradeSignal>,
  workers: [SIGNAL_CLASSIFIER_WORKER, ENTRY_TIMER_WORKER],
  engines: [ENGINE_BINDINGS.tradeSignalAggregatorFinalize],
  persistence: {
    outputSchemaName: "tradeSignal",
    traceMode: "aggregate_workers",
  },
};
