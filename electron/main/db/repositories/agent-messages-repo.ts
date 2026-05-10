import type { DbClient } from "../client";
import type { AgentMessage } from "@/lib/types";
import { asc, eq } from "drizzle-orm";
import { agentMessages } from "../schema";

export class AgentMessagesRepo {
  constructor(private readonly client: DbClient) {}

  listByTrade(tradeId: string): AgentMessage[] {
    const rows = this.client.db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.tradeId, tradeId))
      .orderBy(asc(agentMessages.createdAt))
      .all();
    return rows.map(toAgentMessage);
  }

  listByCycle(cycleId: string): AgentMessage[] {
    const rows = this.client.db
      .select()
      .from(agentMessages)
      .where(eq(agentMessages.cycleId, cycleId))
      .orderBy(asc(agentMessages.createdAt))
      .all();
    return rows.map(toAgentMessage);
  }

  insert(message: AgentMessage): void {
    this.client.db
      .insert(agentMessages)
      .values({
        id: message.id,
        agentRunId: message.agent_run_id,
        sessionId: message.session_id,
        tradeId: message.trade_id,
        cycleId: message.cycle_id ?? null,
        role: message.role,
        providerKey: message.provider_key,
        modelId: message.model_id,
        messagesJson: message.messages_json,
        thinkingJson: message.thinking_json,
        toolCallsJson: message.tool_calls_json,
        outputJson: message.output_json,
        outputSchemaName: message.output_schema_name,
        parseFallback: message.parse_fallback ? 1 : 0,
        strategySnapshotJson: message.strategy_snapshot_json,
        marketSnapshotJson: message.market_snapshot_json,
        createdAt: message.created_at,
      })
      .run();
  }
}

function toAgentMessage(row: Record<string, unknown>): AgentMessage {
  row = normalizeRow(row);
  return {
    id: String(row.id),
    agent_run_id: String(row.agent_run_id),
    session_id: String(row.session_id),
    trade_id: row.trade_id == null ? null : String(row.trade_id),
    cycle_id: row.cycle_id == null ? null : String(row.cycle_id),
    role: row.role as AgentMessage["role"],
    provider_key: String(row.provider_key),
    model_id: String(row.model_id),
    messages_json: String(row.messages_json),
    thinking_json: row.thinking_json == null ? null : String(row.thinking_json),
    tool_calls_json: row.tool_calls_json == null ? null : String(row.tool_calls_json),
    output_json: row.output_json == null ? null : String(row.output_json),
    output_schema_name: row.output_schema_name == null ? null : String(row.output_schema_name),
    parse_fallback: Boolean(row.parse_fallback),
    strategy_snapshot_json: String(row.strategy_snapshot_json),
    market_snapshot_json: row.market_snapshot_json == null ? null : String(row.market_snapshot_json),
    created_at: String(row.created_at),
  };
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...row };
  for (const [key, value] of Object.entries(row)) {
    const snakeKey = key.replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
    if (!(snakeKey in normalized)) {
      normalized[snakeKey] = value;
    }
  }
  return normalized;
}
