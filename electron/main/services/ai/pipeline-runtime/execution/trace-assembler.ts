import type { AgentMessage, AgentRun } from "@/lib/types";
import type { PipelinePhase } from "@electron/shared/ai/pipeline-phase";
import type { RunTrace } from "../../ai-runtime/ai-runtime-types";
import { estimateCostUsd } from "../../model-pricing";
import { buildStrategyPromptContext } from "../prompting/prompt-envelope-builder";
import type { SessionStrategyContext } from "@electron/shared/domain";

export interface TraceAssemblyInput {
  phase: PipelinePhase;
  workerId: string;
  sessionId: string;
  tradeId: string | null;
  cycleId: string | null;
  providerKey: string;
  modelId: string;
  trace: RunTrace<unknown>;
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
    cost_usd: estimateCostUsd(input.modelId, input.trace.inputTokens, input.trace.outputTokens),
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
