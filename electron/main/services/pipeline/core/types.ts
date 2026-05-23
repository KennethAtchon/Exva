import type {
  ToolId,
  EngineBinding,
  RuntimeDefaultsConfig,
  WorkerDefinition,
} from "@electron/shared/ai/ai-phase";
import type { z } from "zod";
import type { LLMRunResult } from "../../llm/llm-types";
import type { WorkerToolContext } from "../worker-tools/worker-tool-factory";
import type { SessionStrategyContext } from "@electron/shared/domain";
import type { AISpendTracker } from "../execution/ai-spend-tracker";

export interface AIWorkerOutputSchema<TOutput> {
  schema: z.ZodType<TOutput>;
  strict: true;
  onValidationFailure: "retry_once" | "fail_worker" | "substitute_empty";
}

export interface WorkerExecConfig {
  retry: RuntimeDefaultsConfig["retry"];
  caps: RuntimeDefaultsConfig["workerCaps"];
  prompt: RuntimeDefaultsConfig["prompt"];
  tools: readonly ToolId[];
  engines: readonly EngineBinding[];
  output: AIWorkerOutputSchema<unknown> | null;
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
export interface AIPhaseRunContext<TInput = Record<string, unknown>> {
  input: TInput;
  sessionId: string;
  cycleId: string | null;
  tradeId: string | null;
  toolContext: WorkerToolContext;
  strategyContext: SessionStrategyContext;
  spendTracker: AISpendTracker;
}

/** Execution capabilities injected by the pipeline-runtime into a phase's `run` handler. */
export interface AIWorkerRunner {
  execute<T>(
    worker: WorkerDefinition,
    task: Record<string, unknown>,
  ): Promise<LLMRunResult<T>>;
  executeGroup<T>(
    tasks: Array<() => Promise<T>>,
    concurrency: number,
  ): Promise<Array<PromiseSettledResult<T>>>;
  canContinueWorkers(): boolean;
}
