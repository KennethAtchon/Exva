import type { PipelineDefinition } from "@electron/shared/ai/pipeline-phase";
import { tradeSignalSchema, type TradeSignal, type TechnicalSignal, type FundamentalSignal, type ReviewSignal } from "@electron/shared/ai/pipeline-signals";
import type { AgentResult } from "../../ai-runtime/ai-runtime-types";
import type { PipelineRunContext, PipelineWorkerRunner } from "../core/types";
import { assembleAggregateTrace } from "../execution/trace-assembler";

export type DecisionPhaseInput = {
  instrumentSymbol: string;
  technical: TechnicalSignal;
  fundamental: FundamentalSignal;
  review: ReviewSignal;
};

const SIGNAL_CLASSIFIER_WORKER = {
  id: "signal-classifier",
  promptAssetPath: "decision",
  tools: [] as const,
  outputMode: "object" as const,
  outputSchema: tradeSignalSchema as import("zod").ZodType<TradeSignal>,
};

async function run(
  rawCtx: unknown,
  rawRunner: unknown,
): Promise<AgentResult<TradeSignal>> {
  const ctx = rawCtx as PipelineRunContext<DecisionPhaseInput>;
  const runner = rawRunner as PipelineWorkerRunner;
  const { instrumentSymbol, technical, fundamental, review } = ctx.input;

  const task: Record<string, unknown> = {
    instrumentSymbol,
    technicalSignal: JSON.stringify(technical),
    fundamentalSignal: JSON.stringify(fundamental),
    reviewSignal: JSON.stringify(review),
  };

  const result = await runner.execute<TradeSignal>(SIGNAL_CLASSIFIER_WORKER, task);
  const output = result.output;

  const aggregate = assembleAggregateTrace({
    phase: "decision",
    sessionId: ctx.sessionId,
    tradeId: ctx.tradeId,
    cycleId: ctx.cycleId,
    providerKey: result.run.provider_key ?? "unknown",
    modelId: result.run.model ?? "unknown",
    strategyContext: ctx.strategyContext,
    schedulingMode: "flat_parallel",
    maxConcurrency: 1,
    output,
    outputSchemaName: "tradeSignal",
    workers: [
      {
        workerId: "signal-classifier",
        frontier: 0,
        dependsOn: [],
        requiredForPhase: true,
        run: result.run,
        message: result.message,
      },
    ],
  });

  return { run: aggregate.run, message: aggregate.message, output };
}

export const DECISION_PHASE: PipelineDefinition<DecisionPhaseInput, TradeSignal> = {
  phase: "decision",
  outputMode: "object",
  outputSchema: tradeSignalSchema as import("zod").ZodType<TradeSignal>,
  workers: [SIGNAL_CLASSIFIER_WORKER],
  persistence: {
    outputSchemaName: "tradeSignal",
    traceMode: "aggregate_workers",
  },
  run,
};
