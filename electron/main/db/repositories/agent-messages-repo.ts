import type { DbClient } from "../client";
import type { AgentMessage } from "@/lib/types";

export class AgentMessagesRepo {
  constructor(private readonly client: DbClient) {}

  listByTrade(tradeId: string): AgentMessage[] {
    const rows = this.client.sqlite
      .prepare("SELECT * FROM agent_messages WHERE trade_id = ? ORDER BY created_at ASC")
      .all(tradeId) as Record<string, unknown>[];
    return rows.map(toAgentMessage);
  }

  insert(message: AgentMessage): void {
    this.client.sqlite
      .prepare(
        `
        INSERT INTO agent_messages (
          id, agent_run_id, session_id, trade_id, cycle_id, role, provider_key, model_id,
          messages_json, thinking_json, tool_calls_json, output_json, output_schema_name,
          parse_fallback, strategy_snapshot_json, market_snapshot_json, created_at
        ) VALUES (
          @id, @agent_run_id, @session_id, @trade_id, @cycle_id, @role, @provider_key, @model_id,
          @messages_json, @thinking_json, @tool_calls_json, @output_json, @output_schema_name,
          @parse_fallback, @strategy_snapshot_json, @market_snapshot_json, @created_at
        )
        `,
      )
      .run({
        ...message,
        cycle_id: message.cycle_id ?? null,
        parse_fallback: message.parse_fallback ? 1 : 0,
      });
  }
}

function toAgentMessage(row: Record<string, unknown>): AgentMessage {
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
