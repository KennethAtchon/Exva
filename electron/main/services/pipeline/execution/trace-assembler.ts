import type { AgentMessage, AgentRun } from "@/lib/types";
import type { PipelinePhase } from "@electron/shared/ai/ai-phase";
import type {
  AIPhaseTrace,
  PhaseTraceWorkerV1,
  PhaseTraceFrontierV1,
} from "@electron/shared/ai/ai-phase-trace";
import type { LLMCallTrace } from "../../llm/llm-types";
import { buildStrategyPromptContext } from "../prompting/strategy-prompt-context";
import type { SessionStrategyContext } from "@electron/shared/domain";

export interface TraceAssemblyInput {
  phase: PipelinePhase;
  workerId: string;
  sessionId: string;
  tradeId: string | null;
  cycleId: string | null;
  providerKey: string;
  modelId: string;
  trace: LLMCallTrace<unknown>;
  outputJson: string | null;
  outputSchemaName: string | null;
  strategyContext: SessionStrategyContext;
  marketSnapshotJson?: string | null;
  parseFallback?: boolean;
}

export interface AssembledTrace {
  run: AgentRun;
  message: AgentMessage;
}

interface ExecutedWorkerTraceInput {
  workerId: string;
  frontier: number;
  dependsOn: string[];
  requiredForPhase: boolean;
  run: AgentRun;
  message: AgentMessage;
}

export interface AggregateTraceAssemblyInput {
  phase: PipelinePhase;
  sessionId: string;
  tradeId: string | null;
  cycleId: string | null;
  providerKey: string;
  modelId: string;
  strategyContext: SessionStrategyContext;
  schedulingMode: "flat_parallel" | "dependency_graph";
  maxConcurrency: number;
  output: unknown;
  outputSchemaName: string | null;
  marketSnapshotJson?: string | null;
  workers: ExecutedWorkerTraceInput[];
}

export function assembleTrace(input: TraceAssemblyInput): AssembledTrace {
  const runId = crypto.randomUUID();
  const { snapshot } = buildStrategyPromptContext(input.strategyContext);

  const run: AgentRun = {
    id: runId,
    trade_id: input.tradeId,
    agent_type: input.phase as string,
    model: input.modelId,
    provider_key: input.providerKey,
    finish_reason: input.trace.finishReason,
    input_tokens: input.trace.inputTokens,
    output_tokens: input.trace.outputTokens,
    cost_usd: input.trace.costUsd,
    output_text: input.trace.assistantText,
    duration_ms: input.trace.durationMs,
    created_at: new Date().toISOString(),
  };

  const thinking =
    input.trace.thinkingText != null && input.trace.thinkingText !== ""
      ? JSON.stringify({ text: input.trace.thinkingText })
      : null;

  const message: AgentMessage = {
    id: crypto.randomUUID(),
    agent_run_id: runId,
    session_id: input.sessionId,
    trade_id: input.tradeId,
    cycle_id: input.cycleId,
    role: input.phase as string,
    provider_key: input.providerKey,
    model_id: input.modelId,
    messages_json: input.trace.auditMessagesJson,
    thinking_json: thinking,
    tool_calls_json: JSON.stringify(input.trace.steps),
    output_json: input.outputJson,
    output_schema_name: input.outputSchemaName,
    parse_fallback: input.parseFallback ?? input.trace.parseFallback,
    strategy_snapshot_json: JSON.stringify(snapshot),
    market_snapshot_json: input.marketSnapshotJson ?? null,
    created_at: run.created_at,
  };

  return { run, message };
}

export function assembleAggregateTrace(
  input: AggregateTraceAssemblyInput,
): AssembledTrace {
  const createdAt = new Date().toISOString();
  const runId = crypto.randomUUID();
  const { snapshot } = buildStrategyPromptContext(input.strategyContext);

  const totalInputTokens = input.workers.reduce(
    (sum, worker) => sum + worker.run.input_tokens,
    0,
  );
  const totalOutputTokens = input.workers.reduce(
    (sum, worker) => sum + worker.run.output_tokens,
    0,
  );
  const totalCostUsd = input.workers.reduce(
    (sum, worker) => sum + worker.run.cost_usd,
    0,
  );
  const totalDurationMs = input.workers.reduce(
    (sum, worker) => sum + worker.run.duration_ms,
    0,
  );
  const startedAt =
    input.workers.map((worker) => worker.run.created_at).sort()[0] ?? createdAt;
  const outputSummary = summarizeOutput(input.output);
  const phaseTrace = buildPhaseTrace({
    phase: input.phase,
    sessionId: input.sessionId,
    tradeId: input.tradeId,
    cycleId: input.cycleId,
    schedulingMode: input.schedulingMode,
    maxConcurrency: input.maxConcurrency,
    startedAt,
    finishedAt: createdAt,
    durationMs: totalDurationMs,
    totalCostUsd,
    totalInputTokens,
    totalOutputTokens,
    aggregateOutputSchemaName: input.outputSchemaName,
    aggregateOutputSummary: outputSummary,
    workers: input.workers,
  });

  const run: AgentRun = {
    id: runId,
    trade_id: input.tradeId,
    agent_type: input.phase,
    model: input.modelId,
    provider_key: input.providerKey,
    finish_reason: "stop",
    input_tokens: totalInputTokens,
    output_tokens: totalOutputTokens,
    cost_usd: totalCostUsd,
    output_text: renderOutputText(input.output),
    duration_ms: totalDurationMs,
    created_at: createdAt,
  };

  const messagesJson = JSON.stringify({
    phase: input.phase,
    workers: input.workers.map((worker) => ({
      workerId: worker.workerId,
      messages:
        safeParseJson(worker.message.messages_json) ??
        worker.message.messages_json,
    })),
  });

  const thinkingBlocks = input.workers
    .map((worker) => ({
      workerId: worker.workerId,
      thinking:
        safeParseJson(worker.message.thinking_json) ??
        worker.message.thinking_json,
    }))
    .filter((entry) => entry.thinking != null);

  const message: AgentMessage = {
    id: crypto.randomUUID(),
    agent_run_id: runId,
    session_id: input.sessionId,
    trade_id: input.tradeId,
    cycle_id: input.cycleId,
    role: input.phase,
    provider_key: input.providerKey,
    model_id: input.modelId,
    messages_json: messagesJson,
    thinking_json:
      thinkingBlocks.length > 0 ? JSON.stringify(thinkingBlocks) : null,
    tool_calls_json: JSON.stringify(phaseTrace),
    output_json: JSON.stringify(input.output),
    output_schema_name: input.outputSchemaName,
    parse_fallback: input.workers.some(
      (worker) => worker.message.parse_fallback,
    ),
    strategy_snapshot_json: JSON.stringify(snapshot),
    market_snapshot_json: input.marketSnapshotJson ?? null,
    created_at: createdAt,
  };

  return { run, message };
}

function buildPhaseTrace(input: {
  phase: PipelinePhase;
  sessionId: string;
  tradeId: string | null;
  cycleId: string | null;
  schedulingMode: "flat_parallel" | "dependency_graph";
  maxConcurrency: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  aggregateOutputSchemaName: string | null;
  aggregateOutputSummary: Record<string, unknown> | null;
  workers: ExecutedWorkerTraceInput[];
}): AIPhaseTrace {
  const frontierMap = new Map<number, ExecutedWorkerTraceInput[]>();
  for (const worker of input.workers) {
    const current = frontierMap.get(worker.frontier) ?? [];
    current.push(worker);
    frontierMap.set(worker.frontier, current);
  }

  const frontiers: PhaseTraceFrontierV1[] = [...frontierMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([frontier, workers]) => {
      const startedAt =
        workers.map((worker) => worker.run.created_at).sort()[0] ??
        input.startedAt;
      const durationMs = workers.reduce(
        (sum, worker) => sum + worker.run.duration_ms,
        0,
      );
      return {
        frontier,
        workerIds: workers.map((worker) => worker.workerId),
        startedAt,
        finishedAt: new Date(
          new Date(startedAt).getTime() + durationMs,
        ).toISOString(),
        durationMs,
        costUsd: workers.reduce((sum, worker) => sum + worker.run.cost_usd, 0),
        status: "succeeded",
      };
    });

  const workers: PhaseTraceWorkerV1[] = input.workers.map((worker) => {
    const toolSteps = safeParseJson(worker.message.tool_calls_json) as Array<{
      toolCalls?: Array<{ tool?: string; error?: string; latencyMs?: number }>;
    }> | null;
    const toolTrace = Array.isArray(toolSteps)
      ? toolSteps.flatMap((step) =>
          (step.toolCalls ?? []).map((call) => ({
            tool: call.tool ?? "unknown",
            status: call.error ? ("error" as const) : ("ok" as const),
            latencyMs: call.latencyMs,
            summary: call.error ?? null,
          })),
        )
      : [];

    return {
      workerId: worker.workerId,
      frontier: worker.frontier,
      dependsOn: worker.dependsOn,
      requiredForPhase: worker.requiredForPhase,
      status: "succeeded",
      startedAt: worker.run.created_at,
      finishedAt: new Date(
        new Date(worker.run.created_at).getTime() + worker.run.duration_ms,
      ).toISOString(),
      durationMs: worker.run.duration_ms,
      costUsd: worker.run.cost_usd,
      inputTokens: worker.run.input_tokens,
      outputTokens: worker.run.output_tokens,
      providerKey: worker.run.provider_key,
      modelId: worker.run.model,
      outputSchemaName: worker.message.output_schema_name,
      outputSummary: summarizeOutput(
        safeParseJson(worker.message.output_json) ?? worker.message.output_json,
      ),
      toolCallCount: toolTrace.length,
      externalCallCount: toolTrace.length,
      blockedBy: [],
      dependencyFailureReason: null,
      error: null,
      toolTrace,
    };
  });

  return {
    version: 1,
    sessionId: input.sessionId,
    cycleId: input.cycleId,
    tradeId: input.tradeId,
    phase: input.phase,
    schedulingMode: input.schedulingMode,
    maxConcurrency: input.maxConcurrency,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: input.durationMs,
    totalCostUsd: input.totalCostUsd,
    totalInputTokens: input.totalInputTokens,
    totalOutputTokens: input.totalOutputTokens,
    aggregateStatus: "succeeded",
    aggregateOutputSchemaName: input.aggregateOutputSchemaName,
    aggregateOutputSummary: input.aggregateOutputSummary,
    frontiers,
    workers,
  };
}

function summarizeOutput(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === "string") return { textPreview: value.slice(0, 200) };
  if (Array.isArray(value))
    return { count: value.length, sample: value.slice(0, 3) };
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(
      0,
      8,
    );
    return Object.fromEntries(
      entries.map(([key, entryValue]) => [key, summarizeLeaf(entryValue)]),
    );
  }
  return { value };
}

function summarizeLeaf(value: unknown): unknown {
  if (typeof value === "string") return value.slice(0, 120);
  if (Array.isArray(value)) return { count: value.length };
  if (value && typeof value === "object") return "[object]";
  return value;
}

function renderOutputText(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(summarizeOutput(value) ?? {}, null, 2);
}

function safeParseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
