import type {
  EngineBinding,
  PipelinePhase,
  WorkerDefinition,
} from "@electron/shared/ai/ai-phase";
import type { LLMRunResult } from "../../../llm/llm-types";
import { runEngineForWorker } from "../../execution/engine-prompt-injector";
import { assembleAggregateTrace } from "../../execution/trace-assembler";
import type { AIPhase, AIPhaseContext } from "../../phases/types";

type WorkerResult = { worker: WorkerDefinition; result: LLMRunResult<unknown> };

type AggregatorPlanState = {
  workers: readonly WorkerDefinition[];
  workerResults: WorkerResult[];
};

export function createAggregatorAIPhase<TOutput>(config: {
  phase: PipelinePhase;
  outputSchemaName: string;
  resolveWorkers: (ctx: AIPhaseContext) => readonly WorkerDefinition[];
  buildTask: (ctx: AIPhaseContext) => Record<string, unknown>;
  concurrency: number;
  collectWorkerOutputs: (
    workers: readonly WorkerDefinition[],
    results: WorkerResult[],
  ) => unknown;
  buildFinalizeTask: (
    ctx: AIPhaseContext,
    workerPayload: unknown,
  ) => Record<string, unknown>;
  finalizeBinding: EngineBinding;
  persistAggregate?: boolean;
}): AIPhase<AggregatorPlanState, TOutput> {
  return {
    phase: config.phase,
    entryModes: [],
    persistAggregate: config.persistAggregate,
    initialState: () => ({ workers: [], workerResults: [] }),
    stages: [
      {
        id: "workers",
        frontier: 0,
        resolveWorkers: (ctx) => [...config.resolveWorkers(ctx)],
        buildTask: (ctx) => config.buildTask(ctx),
        concurrency: config.concurrency,
        toleratePartialFailure: false,
        applyResults(ctx, _state, results) {
          return {
            workers: config.resolveWorkers(ctx),
            workerResults: results,
          };
        },
      },
    ],
    async finalize(ctx, state, workerTraces) {
      const workerPayload = config.collectWorkerOutputs(
        state.workers,
        state.workerResults,
      );
      const output = runEngineForWorker<TOutput>({
        phase: config.phase,
        sessionId: ctx.sessionId,
        cycleId: ctx.cycleId,
        strategyContext: ctx.strategyContext,
        bindings: [],
        binding: config.finalizeBinding,
        task: config.buildFinalizeTask(ctx, workerPayload),
      });

      const aggregate = assembleAggregateTrace({
        phase: config.phase,
        sessionId: ctx.sessionId,
        tradeId: ctx.tradeId,
        cycleId: ctx.cycleId,
        providerKey: workerTraces[0]?.run.provider_key ?? "unknown",
        modelId: workerTraces[0]?.run.model ?? "unknown",
        strategyContext: ctx.strategyContext,
        schedulingMode: "flat_parallel",
        maxConcurrency: config.concurrency,
        output,
        outputSchemaName: config.outputSchemaName,
        workers: workerTraces.map((trace) => ({
          workerId: trace.workerId,
          frontier: trace.frontier,
          dependsOn: trace.dependsOn,
          requiredForPhase: trace.requiredForPhase,
          run: trace.run,
          message: trace.message,
        })),
      });

      return {
        output,
        aggregate: { run: aggregate.run, message: aggregate.message },
      };
    },
    inspect: {
      inputBuilderIds: [],
      stageIds: ["workers"],
      finalizerEngineIds: [config.finalizeBinding.engine],
    },
  };
}

export function pickWorkerOutput<T>(
  results: WorkerResult[],
  schema: WorkerDefinition["outputSchema"],
): T | null {
  for (const entry of results) {
    if (entry.worker.outputSchema === schema) {
      return entry.result.output as T;
    }
  }
  return null;
}
