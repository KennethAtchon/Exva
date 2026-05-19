import type { PipelineDefinition } from "@electron/shared/ai/pipeline-phase";
import { ENGINE_BINDINGS } from "@electron/shared/ai/pipeline-config";
import { tradeSignalSchema, type TradeSignal, type TechnicalSignal, type FundamentalSignal, type ReviewSignal } from "@electron/shared/ai/pipeline-signals";
import { signalForWorkerPrompt } from "@electron/shared/ai/signal-prompt-payload";
import type { AgentResult } from "../../ai-runtime/ai-runtime-types";
import type { PipelineRunContext, PipelineWorkerRunner } from "../core/types";
import { assembleAggregateTrace } from "../execution/trace-assembler";
import {
  aggregateTradeSignal,
  entryTimerOutputSchema,
  signalClassifierOutputSchema,
  type EntryTimerOutput,
  type SignalClassifierOutput,
} from "../../engines/trade-signal-aggregator";

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
  outputMode: "object" as const,
  outputSchema: signalClassifierOutputSchema,
};

const ENTRY_TIMER_WORKER = {
  id: "entry-timer",
  promptAssetPath: "decision-workers/entry-timer",
  tools: [] as const,
  engines: [ENGINE_BINDINGS.riskSummaryRead],
  outputMode: "object" as const,
  outputSchema: entryTimerOutputSchema,
};

const DECISION_WORKERS = [SIGNAL_CLASSIFIER_WORKER, ENTRY_TIMER_WORKER];

function buildDecisionTask(input: DecisionPhaseInput): Record<string, unknown> {
  return {
    instrumentSymbol: input.instrumentSymbol,
    technicalSignal: JSON.stringify(signalForWorkerPrompt(input.technical)),
    fundamentalSignal: JSON.stringify(signalForWorkerPrompt(input.fundamental)),
    reviewSignal: JSON.stringify(signalForWorkerPrompt(input.review)),
  };
}

async function run(
  rawCtx: unknown,
  rawRunner: unknown,
): Promise<AgentResult<TradeSignal>> {
  const ctx = rawCtx as PipelineRunContext<DecisionPhaseInput>;
  const runner = rawRunner as PipelineWorkerRunner;
  const task = buildDecisionTask(ctx.input);

  const results = await runner.executeGroup(
    DECISION_WORKERS.map((worker) => () => runner.execute<unknown>(worker, task)),
    2,
  );

  let classifier: SignalClassifierOutput | null = null;
  let timer: EntryTimerOutput | null = null;
  const workerResults: Array<{
    workerId: string;
    frontier: number;
    dependsOn: string[];
    requiredForPhase: boolean;
    run: AgentResult<unknown>["run"];
    message: AgentResult<unknown>["message"];
  }> = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const worker = DECISION_WORKERS[i]!;
    if (result.status === "fulfilled") {
      workerResults.push({
        workerId: worker.id,
        frontier: 0,
        dependsOn: [],
        requiredForPhase: true,
        run: result.value.run,
        message: result.value.message,
      });
      if (worker.id === "signal-classifier") classifier = result.value.output as SignalClassifierOutput;
      else if (worker.id === "entry-timer") timer = result.value.output as EntryTimerOutput;
    }
  }

  const output = aggregateTradeSignal(ctx.input.instrumentSymbol, ctx.input.review, classifier, timer);

  const phaseRun = workerResults[0]?.run;
  const aggregate = assembleAggregateTrace({
    phase: "decision",
    sessionId: ctx.sessionId,
    tradeId: ctx.tradeId,
    cycleId: ctx.cycleId,
    providerKey: phaseRun?.provider_key ?? "unknown",
    modelId: phaseRun?.model ?? "unknown",
    strategyContext: ctx.strategyContext,
    schedulingMode: "flat_parallel",
    maxConcurrency: 2,
    output,
    outputSchemaName: "tradeSignal",
    workers: workerResults,
  });

  return { run: aggregate.run, message: aggregate.message, output };
}

export const DECISION_PHASE: PipelineDefinition<DecisionPhaseInput, TradeSignal> = {
  phase: "decision",
  outputMode: "object",
  outputSchema: tradeSignalSchema as import("zod").ZodType<TradeSignal>,
  workers: DECISION_WORKERS,
  engines: [ENGINE_BINDINGS.tradeSignalAggregatorFinalize],
  persistence: {
    outputSchemaName: "tradeSignal",
    traceMode: "aggregate_workers",
  },
  run,
};
