import type { PipelineDefinition } from "@electron/shared/ai/pipeline-phase";
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

export type TechnicalPhaseInput = {
  instrumentSymbol: string;
  context?: string;
};

const CHART_PATTERN_WORKER = {
  id: "chart-pattern",
  promptAssetPath: "technical-workers/chart-pattern",
  tools: ["get_ohlcv"] as const,
  outputMode: "object" as const,
  outputSchema: chartPatternOutputSchema,
};

const MOMENTUM_WORKER = {
  id: "momentum-indicator",
  promptAssetPath: "technical-workers/momentum-indicator",
  tools: ["get_ohlcv", "get_quote"] as const,
  outputMode: "object" as const,
  outputSchema: momentumOutputSchema,
};

const VOLUME_WORKER = {
  id: "volume-profile",
  promptAssetPath: "technical-workers/volume-profile",
  tools: ["get_ohlcv"] as const,
  outputMode: "object" as const,
  outputSchema: volumeOutputSchema,
};

const TECHNICAL_WORKERS = [CHART_PATTERN_WORKER, MOMENTUM_WORKER, VOLUME_WORKER];

async function run(
  rawCtx: unknown,
  rawRunner: unknown,
): Promise<AgentResult<TechnicalSignal>> {
  const ctx = rawCtx as PipelineRunContext<TechnicalPhaseInput>;
  const runner = rawRunner as PipelineWorkerRunner;
  const { instrumentSymbol, context } = ctx.input;
  const task: Record<string, unknown> = { instrumentSymbol, context };

  const results = await runner.executeGroup(
    TECHNICAL_WORKERS.map((worker) => () => runner.execute<unknown>(worker, task)),
    3,
  );

  let chartPattern: ChartPatternOutput | null = null;
  let momentum: MomentumOutput | null = null;
  let volume: VolumeOutput | null = null;
  const workerResults: Array<{ workerId: string; frontier: number; dependsOn: string[]; requiredForPhase: boolean; run: AgentResult<unknown>["run"]; message: AgentResult<unknown>["message"] }> = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const worker = TECHNICAL_WORKERS[i]!;
    if (result.status === "fulfilled") {
      workerResults.push({
        workerId: worker.id,
        frontier: 0,
        dependsOn: [],
        requiredForPhase: false,
        run: result.value.run,
        message: result.value.message,
      });
      if (worker.id === "chart-pattern") chartPattern = result.value.output as ChartPatternOutput;
      else if (worker.id === "momentum-indicator") momentum = result.value.output as MomentumOutput;
      else if (worker.id === "volume-profile") volume = result.value.output as VolumeOutput;
    }
  }

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
  workers: TECHNICAL_WORKERS,
  persistence: {
    outputSchemaName: "technicalSignal",
    traceMode: "aggregate_workers",
  },
  run,
};
