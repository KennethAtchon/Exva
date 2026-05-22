import type { AgentMessage, AgentRole, AgentRun } from "@/lib/types";
import type { RunTrace } from "./ai-runtime-types";

export function toRunFromTrace(
  agentType: AgentRole,
  model: string,
  providerKey: string,
  trace: RunTrace<unknown>,
): AgentRun {
  return {
    id: crypto.randomUUID(),
    trade_id: null,
    agent_type: agentType,
    model,
    provider_key: providerKey,
    finish_reason: trace.finishReason,
    input_tokens: trace.inputTokens,
    output_tokens: trace.outputTokens,
    cost_usd: trace.costUsd,
    output_text: trace.assistantText,
    duration_ms: trace.durationMs,
    created_at: new Date().toISOString(),
  };
}

export function buildTraceMessage(input: {
  run: AgentRun;
  role: AgentRole;
  config: { providerKey: string; modelId: string };
  sessionId: string;
  tradeId: string | null;
  cycleId?: string | null;
  trace: RunTrace<unknown>;
  outputJson: string | null;
  outputSchemaName: string | null;
  strategySnapshotJson: string;
  marketSnapshotJson?: string | null;
  parseFallback?: boolean;
}): AgentMessage {
  const thinking =
    input.trace.thinkingText != null && input.trace.thinkingText !== ""
      ? JSON.stringify({ text: input.trace.thinkingText })
      : null;
  return {
    id: crypto.randomUUID(),
    agent_run_id: input.run.id,
    session_id: input.sessionId,
    trade_id: input.tradeId,
    cycle_id: input.cycleId ?? null,
    role: input.role,
    provider_key: input.config.providerKey,
    model_id: input.config.modelId,
    messages_json: input.trace.auditMessagesJson,
    thinking_json: thinking,
    tool_calls_json: JSON.stringify(input.trace.steps),
    output_json: input.outputJson,
    output_schema_name: input.outputSchemaName,
    parse_fallback: input.parseFallback ?? input.trace.parseFallback,
    strategy_snapshot_json: input.strategySnapshotJson,
    market_snapshot_json: input.marketSnapshotJson ?? null,
    created_at: input.run.created_at,
  };
}
