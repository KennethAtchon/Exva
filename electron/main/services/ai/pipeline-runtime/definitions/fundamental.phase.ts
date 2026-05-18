import type { PipelineDefinition } from "@electron/shared/ai/pipeline-phase";
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

export type FundamentalPhaseInput = {
  instrumentSymbol: string;
  context?: string;
};

const EARNINGS_WORKER = {
  id: "earnings-context",
  promptAssetPath: "fundamental-workers/earnings-context",
  tools: ["get_news"] as const,
  outputMode: "object" as const,
  outputSchema: earningsOutputSchema,
};

const CATALYST_WORKER = {
  id: "catalyst-context",
  promptAssetPath: "fundamental-workers/catalyst-context",
  tools: ["get_news", "search_web"] as const,
  outputMode: "object" as const,
  outputSchema: catalystOutputSchema,
};

const SENTIMENT_WORKER = {
  id: "sentiment-context",
  promptAssetPath: "fundamental-workers/sentiment-context",
  tools: ["search_reddit", "search_web"] as const,
  outputMode: "object" as const,
  outputSchema: sentimentOutputSchema,
};

const FUNDAMENTAL_WORKERS = [EARNINGS_WORKER, CATALYST_WORKER, SENTIMENT_WORKER];

async function run(
  rawCtx: unknown,
  rawRunner: unknown,
): Promise<AgentResult<FundamentalSignal>> {
  const ctx = rawCtx as PipelineRunContext<FundamentalPhaseInput>;
  const runner = rawRunner as PipelineWorkerRunner;
  const { instrumentSymbol, context } = ctx.input;
  const task: Record<string, unknown> = { instrumentSymbol, context };

  const results = await runner.executeGroup(
    FUNDAMENTAL_WORKERS.map((worker) => () => runner.execute<unknown>(worker, task)),
    3,
  );

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
    const worker = FUNDAMENTAL_WORKERS[i]!;
    if (result.status === "fulfilled") {
      workerResults.push({
        workerId: worker.id,
        frontier: 0,
        dependsOn: [],
        requiredForPhase: false,
        run: result.value.run,
        message: result.value.message,
      });
      if (worker.id === "earnings-context") earnings = result.value.output as EarningsOutput;
      else if (worker.id === "catalyst-context") catalyst = result.value.output as CatalystOutput;
      else if (worker.id === "sentiment-context") sentiment = result.value.output as SentimentOutput;
    }
  }

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
  workers: FUNDAMENTAL_WORKERS,
  persistence: {
    outputSchemaName: "fundamentalSignal",
    traceMode: "aggregate_workers",
  },
  run,
};
