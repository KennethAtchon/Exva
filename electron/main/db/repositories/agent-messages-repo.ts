import type { DbClient } from "../client";
import type { AgentMessage } from "@/lib/types";

export class AgentMessagesRepo {
  constructor(private readonly client: DbClient) {}

  insert(message: AgentMessage): void {
    this.client.sqlite
      .prepare(
        `
        INSERT INTO agent_messages (
          id, agent_run_id, session_id, trade_id, role, provider_key, model_id,
          messages_json, thinking_json, tool_calls_json, output_json, output_schema_name,
          parse_fallback, strategy_snapshot_json, market_snapshot_json, created_at
        ) VALUES (
          @id, @agent_run_id, @session_id, @trade_id, @role, @provider_key, @model_id,
          @messages_json, @thinking_json, @tool_calls_json, @output_json, @output_schema_name,
          @parse_fallback, @strategy_snapshot_json, @market_snapshot_json, @created_at
        )
        `,
      )
      .run({
        ...message,
        parse_fallback: message.parse_fallback ? 1 : 0,
      });
  }
}
