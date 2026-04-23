import type { DbClient } from "../client";
import type { AgentRun } from "@/lib/types";
import { toAgentRun } from "./mappers";

export class AgentRunsRepo {
  constructor(private readonly client: DbClient) {}

  listByTrade(tradeId: string): AgentRun[] {
    const rows = this.client.sqlite
      .prepare("SELECT * FROM agent_runs WHERE trade_id = ? ORDER BY created_at ASC")
      .all(tradeId) as Record<string, unknown>[];
    return rows.map(toAgentRun);
  }

  insert(run: AgentRun): void {
    this.client.sqlite
      .prepare(
        `
        INSERT INTO agent_runs (
          id, trade_id, agent_type, model, input_tokens, output_tokens,
          cost_usd, output_text, duration_ms, created_at
        ) VALUES (
          @id, @trade_id, @agent_type, @model, @input_tokens, @output_tokens,
          @cost_usd, @output_text, @duration_ms, @created_at
        )
        `,
      )
      .run(run);
  }
}
