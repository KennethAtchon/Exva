import type { ToolId, EngineBinding, RuntimeDefaultsConfig, WorkerDefinition } from "@electron/shared/ai/pipeline-phase";
import type { z } from "zod";
import type { AgentResult } from "../../ai-runtime/ai-runtime-types";
import type { ToolBuildContext } from "../context/tool-factory-registry";
import type { SessionStrategyContext } from "@electron/shared/domain";
import type { PipelineSpendTracker } from "../execution/pipeline-spend-tracker";

export interface WorkerOutputContract<TOutput> {
  schema: z.ZodType<TOutput>;
  strict: true;
  onValidationFailure: "retry_once" | "fail_worker" | "substitute_empty";
}

export interface ResolvedWorkerRuntimeConfig {
  retry: RuntimeDefaultsConfig["retry"];
  caps: RuntimeDefaultsConfig["workerCaps"];
  prompt: RuntimeDefaultsConfig["prompt"];
  tools: readonly ToolId[];
  engines: readonly EngineBinding[];
  output: WorkerOutputContract<unknown> | null;
  terminalToolNames: readonly string[];
}

export interface PhaseRunInput<TInput = Record<string, unknown>> {
  sessionId: string;
  cycleId?: string | null;
  tradeId?: string | null;
  input: TInput;
}

export interface PhaseRunResult<TOutput> {
  output: TOutput;
  runId: string;
  messageId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
}

/** Context passed into a phase's custom `run` handler. */
export interface PipelineRunContext<TInput = Record<string, unknown>> {
  input: TInput;
  sessionId: string;
  cycleId: string | null;
  tradeId: string | null;
  toolContext: ToolBuildContext;
  strategyContext: SessionStrategyContext;
  spendTracker: PipelineSpendTracker;
}

/** Execution capabilities injected by the pipeline-runtime into a phase's `run` handler. */
export interface PipelineWorkerRunner {
  execute<T>(worker: WorkerDefinition, task: Record<string, unknown>): Promise<AgentResult<T>>;
  executeGroup<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<Array<PromiseSettledResult<T>>>;
  canContinueWorkers(): boolean;
}
