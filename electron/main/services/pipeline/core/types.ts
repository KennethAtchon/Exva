import type {
  ToolId,
  EngineBinding,
  RuntimeDefaultsConfig,
  WorkerDefinition,
} from "@electron/shared/ai/ai-phase";
import type { z } from "zod";
import type { LLMRunResult } from "../../llm/llm-types";

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

/** Context passed into a phase's custom `run` handler. */
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
