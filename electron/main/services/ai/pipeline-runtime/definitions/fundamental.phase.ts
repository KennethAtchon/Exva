import type { PipelineDefinition, WorkerDefinition } from "@electron/shared/ai/pipeline-phase";
import { ENGINE_BINDINGS } from "@electron/shared/ai/pipeline-config";
import type { SelectorEvidence } from "@electron/shared/ai/selector-pipeline-candidate";
import { fundamentalSignalSchema, type FundamentalSignal } from "@electron/shared/ai/pipeline-signals";
import type { AgentResult } from "../../ai-runtime/ai-runtime-types";
import type { PipelineRunContext, PipelineWorkerRunner } from "../core/types";
import { assembleAggregateTrace } from "../execution/trace-assembler";
import {
  aggregateFundamentalSignal,
  earningsOutputSchema,
  catalystOutputSchema,
  sentimentOutputSchema,
  type EarningsOutput,
  type CatalystOutput,
  type SentimentOutput,
} from "../../engines/fundamental-aggregator";
import { fundamentalWorkersForMode } from "../pipeline-discovery-config";

export type FundamentalPhaseInput = {
  instrumentSymbol: string;
  selectorEvidence?: SelectorEvidence | null;
};

function collectFundamentalOutputs(
  workers: readonly WorkerDefinition[],
  results: Array<PromiseSettledResult<AgentResult<unknown>>>,
): {
  earnings: EarningsOutput | null;
  catalyst: CatalystOutput | null;
  sentiment: SentimentOutput | null;
  workerResults: Array<{
    workerId: string;
    frontier: number;
    dependsOn: string[];
    requiredForPhase: boolean;
    run: AgentResult<unknown>["run"];
    message: AgentResult<unknown>["message"];
  }>;
} {
  let earnings: EarningsOutput | null = null;
  let catalyst: CatalystOutput | null = null;
  let sentiment: SentimentOutput | null = null;
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
    if (worker.outputSchema === earningsOutputSchema) {
      earnings = result.value.output as EarningsOutput;
    } else if (worker.outputSchema === catalystOutputSchema) {
      catalyst = result.value.output as CatalystOutput;
    } else if (worker.outputSchema === sentimentOutputSchema) {
      sentiment = result.value.output as SentimentOutput;
    }
  }

  return { earnings, catalyst, sentiment, workerResults };
}

async function run(
  rawCtx: unknown,
  rawRunner: unknown,
): Promise<AgentResult<FundamentalSignal>> {
  const ctx = rawCtx as PipelineRunContext<FundamentalPhaseInput>;
  const runner = rawRunner as PipelineWorkerRunner;
  const { instrumentSymbol, selectorEvidence } = ctx.input;
  const task: Record<string, unknown> = { instrumentSymbol, selectorEvidence };
  const workers = fundamentalWorkersForMode(ctx.strategyContext.researchPosture.discoveryMode);

  const results = await runner.executeGroup(
    workers.map((worker) => () => runner.execute<unknown>(worker, task)),
    3,
  );

  const { earnings, catalyst, sentiment, workerResults } = collectFundamentalOutputs(workers, results);
  const output = aggregateFundamentalSignal(instrumentSymbol, { earnings, catalyst, sentiment });

  const phaseRun = workerResults[0]?.run;
  const aggregate = assembleAggregateTrace({
    phase: "fundamental",
    sessionId: ctx.sessionId,
    tradeId: ctx.tradeId,
    cycleId: ctx.cycleId,
    providerKey: phaseRun?.provider_key ?? "unknown",
    modelId: phaseRun?.model ?? "unknown",
    strategyContext: ctx.strategyContext,
    schedulingMode: "flat_parallel",
    maxConcurrency: 3,
    output,
    outputSchemaName: "fundamentalSignal",
    workers: workerResults,
  });

  return { run: aggregate.run, message: aggregate.message, output };
}

export const FUNDAMENTAL_PHASE: PipelineDefinition<FundamentalPhaseInput, FundamentalSignal> = {
  phase: "fundamental",
  outputMode: "object",
  outputSchema: fundamentalSignalSchema as import("zod").ZodType<FundamentalSignal>,
  workers: fundamentalWorkersForMode("trend_scan"),
  engines: [ENGINE_BINDINGS.fundamentalAggregatorFinalize],
  persistence: {
    outputSchemaName: "fundamentalSignal",
    traceMode: "aggregate_workers",
  },
  run,
};
