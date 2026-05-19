import type { PipelineDefinition } from "@electron/shared/ai/pipeline-phase";
import { reviewSignalSchema, type ReviewSignal, type TechnicalSignal, type FundamentalSignal } from "@electron/shared/ai/pipeline-signals";
import { signalForWorkerPrompt } from "@electron/shared/ai/signal-prompt-payload";
import type { AgentResult } from "../../ai-runtime/ai-runtime-types";
import type { PipelineRunContext, PipelineWorkerRunner } from "../core/types";
import { assembleAggregateTrace } from "../execution/trace-assembler";
import {
  aggregateReviewSignal,
  conflictDetectorOutputSchema,
  riskAssessorOutputSchema,
  type ConflictDetectorOutput,
  type RiskAssessorOutput,
} from "../../engines/review-aggregator";

export type ReviewPhaseInput = {
  instrumentSymbol: string;
  technical: TechnicalSignal;
  fundamental: FundamentalSignal;
};

const CONFLICT_DETECTOR_WORKER = {
  id: "conflict-detector",
  promptAssetPath: "review-workers/conflict-detector",
  tools: [] as const,
  outputMode: "object" as const,
  outputSchema: conflictDetectorOutputSchema,
};

const RISK_ASSESSOR_WORKER = {
  id: "risk-assessor",
  promptAssetPath: "review-workers/risk-assessor",
  tools: [] as const,
  outputMode: "object" as const,
  outputSchema: riskAssessorOutputSchema,
};

const REVIEW_WORKERS = [CONFLICT_DETECTOR_WORKER, RISK_ASSESSOR_WORKER];

async function run(
  rawCtx: unknown,
  rawRunner: unknown,
): Promise<AgentResult<ReviewSignal>> {
  const ctx = rawCtx as PipelineRunContext<ReviewPhaseInput>;
  const runner = rawRunner as PipelineWorkerRunner;
  const { instrumentSymbol, technical, fundamental } = ctx.input;
  const task: Record<string, unknown> = {
    instrumentSymbol,
    technicalSignal: JSON.stringify(signalForWorkerPrompt(technical)),
    fundamentalSignal: JSON.stringify(signalForWorkerPrompt(fundamental)),
  };

  const results = await runner.executeGroup(
    REVIEW_WORKERS.map((worker) => () => runner.execute<unknown>(worker, task)),
    2,
  );

  let conflictDetector: ConflictDetectorOutput | null = null;
  let riskAssessor: RiskAssessorOutput | null = null;
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
    const worker = REVIEW_WORKERS[i]!;
    if (result.status === "fulfilled") {
      workerResults.push({
        workerId: worker.id,
        frontier: 0,
        dependsOn: [],
        requiredForPhase: false,
        run: result.value.run,
        message: result.value.message,
      });
      if (worker.id === "conflict-detector") conflictDetector = result.value.output as ConflictDetectorOutput;
      else if (worker.id === "risk-assessor") riskAssessor = result.value.output as RiskAssessorOutput;
    }
  }

  const output = aggregateReviewSignal(instrumentSymbol, { conflictDetector, riskAssessor });

  const phaseRun = workerResults[0]?.run;
  const aggregate = assembleAggregateTrace({
    phase: "review",
    sessionId: ctx.sessionId,
    tradeId: ctx.tradeId,
    cycleId: ctx.cycleId,
    providerKey: phaseRun?.provider_key ?? "unknown",
    modelId: phaseRun?.model ?? "unknown",
    strategyContext: ctx.strategyContext,
    schedulingMode: "flat_parallel",
    maxConcurrency: 2,
    output,
    outputSchemaName: "reviewSignal",
    workers: workerResults,
  });

  return { run: aggregate.run, message: aggregate.message, output };
}

export const REVIEW_PHASE: PipelineDefinition<ReviewPhaseInput, ReviewSignal> = {
  phase: "review",
  outputMode: "object",
  outputSchema: reviewSignalSchema as import("zod").ZodType<ReviewSignal>,
  workers: REVIEW_WORKERS,
  persistence: {
    outputSchemaName: "reviewSignal",
    traceMode: "aggregate_workers",
  },
  run,
};
