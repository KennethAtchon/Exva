import { z } from "zod";
import type { PrepareStepFunction, ToolSet } from "ai";
import type { WorkerToolConfig } from "./pipeline-config";

export type PipelinePhase =
  | "selector"
  | "technical"
  | "fundamental"
  | "review"
  | "decision";

export const PIPELINE_PHASES: PipelinePhase[] = [
  "selector",
  "technical",
  "fundamental",
  "review",
  "decision",
];

export type ToolId = string;
export type EngineId = string;
export type EngineKind =
  | "context"
  | "policy"
  | "validator"
  | "transformer"
  | "execution"
  | "lifecycle";
export type PipelineFinalizerId = string;
export type WorkerInputBuilderId = string;

export interface EngineBinding {
  engine: EngineId;
  kind: EngineKind;
  mode: "read" | "write" | "finalize";
  config?: Record<string, unknown>;
}

export type AggregateStrategy<TOutput> = (
  results: Array<Partial<TOutput>>,
) => TOutput;

export type WorkerToolRequirement = {
  requiredAny?: readonly string[];
  requiredAll?: readonly string[];
  minToolCalls?: number;
};

export type StrategyContextField =
  | "identity"
  | "researchPosture"
  | "tradeRules"
  | "riskLimits"
  | "timeframe"
  | "presetBehavior";

export type StrategyGuidanceField =
  | "objective"
  | "whatToLookFor"
  | "howToEvaluate"
  | "avoid";

export interface WorkerStrategyContextRequest {
  fields: readonly StrategyContextField[];
  guidance: readonly StrategyGuidanceField[];
  maxGuidanceItems?: number;
}

/**
 * Worker output mode.
 * - `tool_result`: worker yields its result by calling a runtime-configured
 *   terminal tool whose input schema is `outputSchema`. This is the standard
 *   path for any worker with a structured contract.
 * - `text`: worker produces free-form assistant text (no schema).
 */
export type WorkerOutputMode = "text" | "tool_result";

export const DEFAULT_OUTPUT_TOOL_NAME = "submit_result";

/** Per-worker configuration of the terminal output tool. */
export interface WorkerOutputToolConfig {
  /** Tool name surfaced to the model. Defaults to `submit_result`. */
  name?: string;
  /** Description surfaced to the model for the terminal tool. */
  description?: string;
}

export interface WorkerDefinition<TPhaseOutput = unknown> {
  id: string;
  prompt: string;
  tools: readonly ToolId[];
  toolRequirements?: WorkerToolRequirement;
  strategyContext: WorkerStrategyContextRequest;
  toolConfig?: WorkerToolConfig;
  engines?: readonly EngineBinding[];
  outputMode: WorkerOutputMode;
  outputSchema?: z.ZodType<Partial<TPhaseOutput>>;
  /** Terminal output tool config; only meaningful when `outputSchema` is set. */
  outputTool?: WorkerOutputToolConfig;
  inputBuilder?: WorkerInputBuilderId;
  dependsOn?: readonly string[];
  requiredForPhase?: boolean;
  caps?: {
    maxSteps?: number;
    spendLimitUsd?: number;
    maxTokens?: number;
  };
}

export interface PipelineDefinition<TInput = unknown, TOutput = unknown> {
  phase: PipelinePhase;
  inputSchema?: z.ZodType<TInput>;
  outputMode: "text" | "object" | "tool_terminal";
  outputSchema?: z.ZodType<TOutput>;
  workers: readonly WorkerDefinition<TOutput>[];
  scheduling?: {
    mode: "flat_parallel" | "dependency_graph";
    maxConcurrency: number;
  };
  engines?: readonly EngineBinding[];
  aggregate?: AggregateStrategy<TOutput> | PipelineFinalizerId;
  persistence: {
    outputSchemaName: string | null;
    traceMode: "single_phase_run" | "aggregate_workers";
  };
  /** Optional runtime step planner (for tool_terminal phases such as selector). */
  buildPrepareStep?: (ctx: unknown) => PrepareStepFunction<ToolSet> | undefined;
  /** Tool names that terminate the agent loop (for tool_terminal phases). */
  terminalToolNames?: readonly string[];
  /**
   * Custom multi-stage execution handler. When defined, replaces the standard
   * worker-graph executor. The runtime passes typed ctx and runner as `unknown`
   * to avoid circular dependencies with main-package types; cast inside the
   * implementing definition file.
   */
  run?: (ctx: unknown, runner: unknown) => Promise<unknown>;
}

export interface RuntimeDefaultsConfig {
  retry: {
    providerAttempts: number;
    providerBackoffMs: readonly number[];
    stepAttempts: number;
    stepBackoffMs: readonly number[];
  };
  workerCaps: {
    maxSteps: number;
    spendLimitUsd: number;
    maxTokens?: number;
  };
  prompt: {
    maxSystemChars: number;
    maxUserPayloadChars: number;
  };
}

export interface PhaseDefaultsConfig {
  phase: PipelinePhase;
  phaseSpendCapUsd?: number;
  workerCaps?: Partial<RuntimeDefaultsConfig["workerCaps"]>;
  retry?: Partial<RuntimeDefaultsConfig["retry"]>;
  tools?: readonly ToolId[];
  engines?: readonly EngineBinding[];
}

export const RUNTIME_DEFAULTS: RuntimeDefaultsConfig = {
  retry: {
    providerAttempts: 4,
    providerBackoffMs: [1_000, 2_000, 4_000, 8_000],
    stepAttempts: 5,
    stepBackoffMs: [30_000, 60_000, 120_000, 240_000],
  },
  workerCaps: {
    maxSteps: 50,
    spendLimitUsd: 1.0,
    maxTokens: 8_192,
  },
  prompt: {
    maxSystemChars: 8_000,
    maxUserPayloadChars: 16_000,
  },
};

export const PHASE_DEFAULTS: Record<PipelinePhase, PhaseDefaultsConfig> = {
  selector: {
    phase: "selector",
    phaseSpendCapUsd: 0.3,
    workerCaps: { maxSteps: 50, spendLimitUsd: 0.3 },
  },
  technical: {
    phase: "technical",
    phaseSpendCapUsd: 0.08,
    workerCaps: { maxSteps: 50, spendLimitUsd: 0.08 },
  },
  fundamental: {
    phase: "fundamental",
    phaseSpendCapUsd: 0.08,
    workerCaps: { maxSteps: 50, spendLimitUsd: 0.08 },
  },
  review: {
    phase: "review",
    phaseSpendCapUsd: 0.05,
    workerCaps: { maxSteps: 50, spendLimitUsd: 0.05 },
  },
  decision: {
    phase: "decision",
    phaseSpendCapUsd: 0.05,
    workerCaps: { maxSteps: 50, spendLimitUsd: 0.05 },
  },
};

export const REASONING_LEVELS = [
  "off",
  "auto",
  "low",
  "medium",
  "high",
  "max",
] as const;

export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

export const REASONING_LEVEL_OPTIONS: ReadonlyArray<{
  value: ReasoningLevel;
  label: string;
}> = [
  { value: "off", label: "Off" },
  { value: "auto", label: "Auto" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "max", label: "Max" },
];

export const DEFAULT_REASONING_LEVEL: ReasoningLevel = "off";

export interface SessionAiPhase {
  sessionId: string;
  phase: PipelinePhase;
  providerKey: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
  reasoningLevel: ReasoningLevel;
  promptSource: "default" | "session_override";
  promptMarkdown: string;
  updatedAt: string;
}

export interface SessionAiPhaseWorker {
  sessionId: string;
  phase: PipelinePhase;
  workerId: string;
  providerKey?: string | null;
  modelId?: string | null;
  maxSteps?: number | null;
  spendLimitUsd?: number | null;
  promptMarkdown?: string | null;
  updatedAt: string;
}

export interface PhaseRuntimeSummary {
  phase: PipelinePhase;
  providerKey: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
  reasoningLevel: ReasoningLevel;
  promptSource: "default" | "session_override";
  promptMarkdown: string;
  workerOverrides: SessionAiPhaseWorker[];
}
