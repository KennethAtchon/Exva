import type { ToolId, EngineBinding, RuntimeDefaultsConfig } from "@electron/shared/ai/pipeline-phase";
import type { z } from "zod";

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
