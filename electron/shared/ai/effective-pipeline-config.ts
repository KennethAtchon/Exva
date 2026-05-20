import type { EngineBinding, PipelinePhase } from "./pipeline-phase";

export type PipelineConfigSource = "default" | "db" | "session" | "derived";

export interface EffectivePipelineConfigSourceEntry {
  path: string;
  source: PipelineConfigSource;
  value: unknown;
}

export interface EffectiveWorkerConfig {
  phase: PipelinePhase;
  workerId: string;
  promptAssetPath: string;
  promptSource: "default" | "session_override";
  providerKey: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
  tools: readonly string[];
  toolConfig?: unknown;
  engines: readonly EngineBinding[];
  outputMode: "text" | "object" | "tool_terminal";
  outputSchemaName: string | null;
  dependsOn: readonly string[];
  requiredForPhase: boolean;
  caps: {
    maxSteps: number;
    spendLimitUsd: number;
    maxTokens?: number;
  };
  retry: {
    providerAttempts: number;
    providerBackoffMs: readonly number[];
    stepAttempts: number;
    stepBackoffMs: readonly number[];
  };
  terminalToolNames: readonly string[];
}

export interface EffectiveStageConfig {
  id: PipelinePhase;
  kind: "phase";
  phase: PipelinePhase;
  variantKey: string;
  outputMode: "text" | "object" | "tool_terminal";
  outputSchemaName: string | null;
  schedulingMode: "flat_parallel" | "dependency_graph" | "custom_run";
  maxConcurrency: number;
  traceMode: "single_phase_run" | "aggregate_workers";
  phaseSpendCapUsd: number;
  inputBuilders?: readonly string[];
  cachePolicy?: string;
  engines: readonly EngineBinding[];
  workers: EffectiveWorkerConfig[];
}

export interface EffectiveBudgetConfig {
  totalSpendCapUsd: number;
  phases: Record<PipelinePhase, { phaseSpendCapUsd: number }>;
}

export interface EffectivePipelineConfig {
  pipelineId: string;
  sessionId: string;
  stages: EffectiveStageConfig[];
  workers: EffectiveWorkerConfig[];
  engines: EngineBinding[];
  budgets: EffectiveBudgetConfig;
  sourceMap: EffectivePipelineConfigSourceEntry[];
}
