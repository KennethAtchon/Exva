import type { PipelineDefinition, WorkerDefinition } from "@electron/shared/ai/pipeline-phase";
import { ENGINE_BINDINGS } from "@electron/shared/ai/pipeline-config";
import type { SelectorEvidence } from "@electron/shared/ai/selector-pipeline-candidate";
import { technicalSignalSchema, type TechnicalSignal } from "@electron/shared/ai/pipeline-signals";
import type { AgentResult } from "../../ai-runtime/ai-runtime-types";
import type { PipelineRunContext, PipelineWorkerRunner } from "../core/types";
import { assembleAggregateTrace } from "../execution/trace-assembler";
import {
  aggregateTechnicalSignal,
  chartPatternOutputSchema,
  momentumOutputSchema,
  volumeOutputSchema,
  type ChartPatternOutput,
  type MomentumOutput,
  type VolumeOutput,
} from "../../engines/technical-aggregator";
import { technicalWorkersForMode } from "../pipeline-discovery-config";

export type TechnicalPhaseInput = {
  instrumentSymbol: string;
  selectorEvidence?: SelectorEvidence | null;
};

function collectTechnicalOutputs(
  workers: readonly WorkerDefinition[],
  results: Array<PromiseSettledResult<AgentResult<unknown>>>,
): {
  chartPattern: ChartPatternOutput | null;
  momentum: MomentumOutput | null;
  volume: VolumeOutput | null;
  workerResults: Array<{
    workerId: string;
    frontier: number;
    dependsOn: string[];
    requiredForPhase: boolean;
    run: AgentResult<unknown>["run"];
    message: AgentResult<unknown>["message"];
  }>;
} {
  let chartPattern: ChartPatternOutput | null = null;
  let momentum: MomentumOutput | null = null;
  let volume: VolumeOutput | null = null;
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
    const worker = workers[i]!;
    if (result?.status !== "fulfilled") continue;
    workerResults.push({
      workerId: worker.id,
      frontier: 0,
      dependsOn: [],
      requiredForPhase: false,
      run: result.value.run,
      message: result.value.message,
    });
    if (worker.outputSchema === chartPatternOutputSchema) {
      chartPattern = result.value.output as ChartPatternOutput;
    } else if (worker.outputSchema === momentumOutputSchema) {
      momentum = result.value.output as MomentumOutput;
    } else if (worker.outputSchema === volumeOutputSchema) {
      volume = result.value.output as VolumeOutput;
    }
  }

  return { chartPattern, momentum, volume, workerResults };
}

async function run(
  rawCtx: unknown,
  rawRunner: unknown,
): Promise<AgentResult<TechnicalSignal>> {
  const ctx = rawCtx as PipelineRunContext<TechnicalPhaseInput>;
  const runner = rawRunner as PipelineWorkerRunner;
  const { instrumentSymbol, selectorEvidence } = ctx.input;
  const task: Record<string, unknown> = { instrumentSymbol, selectorEvidence };
  const workers = technicalWorkersForMode(ctx.strategyContext.researchPosture.discoveryMode);

  const results = await runner.executeGroup(
    workers.map((worker) => () => runner.execute<unknown>(worker, task)),
    3,
  );

  const { chartPattern, momentum, volume, workerResults } = collectTechnicalOutputs(workers, results);
  const output = aggregateTechnicalSignal(instrumentSymbol, { chartPattern, momentum, volume });

  const phaseRun = workerResults[0]?.run;
  const aggregate = assembleAggregateTrace({
    phase: "technical",
    sessionId: ctx.sessionId,
    tradeId: ctx.tradeId,
    cycleId: ctx.cycleId,
    providerKey: phaseRun?.provider_key ?? "unknown",
    modelId: phaseRun?.model ?? "unknown",
    strategyContext: ctx.strategyContext,
    schedulingMode: "flat_parallel",
    maxConcurrency: 3,
    output,
    outputSchemaName: "technicalSignal",
    workers: workerResults,
  });

  return { run: aggregate.run, message: aggregate.message, output };
}

export const TECHNICAL_PHASE: PipelineDefinition<TechnicalPhaseInput, TechnicalSignal> = {
  phase: "technical",
  outputMode: "object",
  outputSchema: technicalSignalSchema as import("zod").ZodType<TechnicalSignal>,
  workers: technicalWorkersForMode("trend_scan"),
  engines: [ENGINE_BINDINGS.technicalAggregatorFinalize],
  persistence: {
    outputSchemaName: "technicalSignal",
    traceMode: "aggregate_workers",
  },
  run,
};
