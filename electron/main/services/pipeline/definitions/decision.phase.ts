import type { WorkerDefinition } from "@electron/shared/ai/ai-phase";
import { ENGINE_BINDINGS } from "@electron/shared/ai/ai-phase-config";
import {
  type TradeSignal,
  type TechnicalSignal,
  type FundamentalSignal,
  type ReviewSignal,
} from "@electron/shared/ai/trade-signals";
import { signalForWorkerPrompt } from "@electron/shared/ai/worker-prompt-payload";
import type { LLMRunResult } from "../../llm/llm-types";
import {
  entryTimerOutputSchema,
  signalClassifierOutputSchema,
} from "../../signal/aggregators/trade-signal-aggregator";
import type { AIPhase } from "../phases/types";
import {
  DECISION_WORKERS_ENTRY_TIMER_PROMPT,
  DECISION_WORKERS_SIGNAL_CLASSIFIER_PROMPT,
} from "../worker-prompts";

type WorkerResult = { worker: WorkerDefinition; result: LLMRunResult<unknown> };

export type AggregatorPlanState = {
  workers: readonly WorkerDefinition[];
  workerResults: WorkerResult[];
};

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

export const DECISION_WORKERS: readonly WorkerDefinition[] = [
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
  persistAggregate: false,
  finalizeEngineIds: ["trade-signal-aggregator"],
  initialState: () => ({ workers: [], workerResults: [] }),
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
      applyResults(_ctx, _state, results) {
        return { workers: DECISION_WORKERS, workerResults: results };
      },
    },
  ],
};
