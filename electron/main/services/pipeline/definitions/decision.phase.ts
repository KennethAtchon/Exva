import type { WorkerDefinition } from "@electron/shared/ai/ai-phase";
import { ENGINE_BINDINGS } from "@electron/shared/ai/ai-phase-config";
import {
  tradeSignalSchema,
  type TradeSignal,
  type TechnicalSignal,
  type FundamentalSignal,
  type ReviewSignal,
} from "@electron/shared/ai/trade-signals";
// Self-registers the trade-signal-aggregator finalizer engine when this module loads.
import "../engines/finalizer/trade-signal-aggregator";
import { signalForWorkerPrompt } from "@electron/shared/ai/worker-prompt-payload";
import {
  entryTimerOutputSchema,
  signalClassifierOutputSchema,
} from "../../signal/aggregators/trade-signal-aggregator";
import type { AIPhase } from "../phases/types";
import {
  DECISION_WORKERS_ENTRY_TIMER_PROMPT,
  DECISION_WORKERS_SIGNAL_CLASSIFIER_PROMPT,
} from "../worker-prompts";
import type { AggregatorPlanState } from "./aggregator.types";

export type { AggregatorPlanState };

export type DecisionPhaseInput = {
  instrumentSymbol: string;
  technical: TechnicalSignal;
  fundamental: FundamentalSignal;
  review: ReviewSignal;
};

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

const DECISION_WORKERS: readonly WorkerDefinition[] = [
  {
    id: "signal-classifier",
    prompt: DECISION_WORKERS_SIGNAL_CLASSIFIER_PROMPT,
    tools: [],
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    strategyContext: DECISION_STRATEGY_CONTEXT,
    outputMode: "tool_result",
    outputSchema: signalClassifierOutputSchema,
  },
  {
    id: "entry-timer",
    prompt: DECISION_WORKERS_ENTRY_TIMER_PROMPT,
    tools: [],
    engines: [ENGINE_BINDINGS.riskSummaryRead],
    strategyContext: DECISION_STRATEGY_CONTEXT,
    outputMode: "tool_result",
    outputSchema: entryTimerOutputSchema,
  },
];

export const DECISION_PHASE: AIPhase<AggregatorPlanState, TradeSignal> = {
  phase: "decision",
  outputSchemaName: "tradeSignal",
  persistAggregate: false,
  catalog: {
    outputMode: "object",
    outputSchema: tradeSignalSchema,
    engines: [ENGINE_BINDINGS.tradeSignalAggregatorFinalize],
  },
  resolveWorkersForMode: () => DECISION_WORKERS,
  finalizeEngineIds: ["trade-signal-aggregator"],
  initialState: (): AggregatorPlanState => ({}),
  stages: [
    {
      id: "workers",
      frontier: 0,
      resolveWorkers: () => [...DECISION_WORKERS],
      buildTask(ctx) {
        return {
          instrumentSymbol: ctx.input.instrumentSymbol,
          technicalSignal: JSON.stringify(
            signalForWorkerPrompt(ctx.input.technical as TechnicalSignal),
          ),
          fundamentalSignal: JSON.stringify(
            signalForWorkerPrompt(ctx.input.fundamental as FundamentalSignal),
          ),
          reviewSignal: JSON.stringify(
            signalForWorkerPrompt(ctx.input.review as ReviewSignal),
          ),
        };
      },
      concurrency: 2,
      toleratePartialFailure: false,
      applyResults(_ctx, state) {
        // Worker results flow through the FinalizerEngine.run workerResults param.
        // Mock scenario logic (isMockSession / mockScenarioKind) is handled in
        // engines/finalizer/trade-signal-aggregator.ts where ctx.toolContext is available.
        return state;
      },
    },
  ],
};
