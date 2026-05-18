import type { PipelinePhase } from "./pipeline-phase";

export interface PhaseTraceV1 {
  version: 1;
  sessionId: string;
  cycleId: string | null;
  tradeId: string | null;
  phase: PipelinePhase;
  schedulingMode: "flat_parallel" | "dependency_graph";
  maxConcurrency: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  aggregateStatus: "succeeded" | "failed" | "degraded";
  aggregateOutputSchemaName: string | null;
  aggregateOutputSummary: Record<string, unknown> | null;
  frontiers: PhaseTraceFrontierV1[];
  workers: PhaseTraceWorkerV1[];
}

export interface PhaseTraceFrontierV1 {
  frontier: number;
  workerIds: string[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  costUsd: number;
  status: "succeeded" | "failed" | "degraded";
}

export interface PhaseTraceWorkerV1 {
  workerId: string;
  frontier: number;
  dependsOn: string[];
  requiredForPhase: boolean;
  status: "pending" | "blocked" | "running" | "succeeded" | "failed" | "skipped" | "degraded";
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  providerKey: string;
  modelId: string;
  outputSchemaName: string | null;
  outputSummary: Record<string, unknown> | null;
  toolCallCount: number;
  externalCallCount: number;
  blockedBy: string[];
  dependencyFailureReason: string | null;
  error: { code: string; message: string } | null;
  toolTrace: Array<{
    tool: string;
    status: "ok" | "error";
    latencyMs?: number;
    costUsd?: number | null;
    summary?: string | null;
  }>;
}
