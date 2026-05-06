import type { DbClient } from "../client";
import type { AgentRun } from "@/lib/types";
import { asc, eq } from "drizzle-orm";
import { agentRuns } from "../schema";
import { toAgentRun } from "./mappers";

export class AgentRunsRepo {
  constructor(private readonly client: DbClient) {}

  listByTrade(tradeId: string): AgentRun[] {
    const rows = this.client.db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.tradeId, tradeId))
      .orderBy(asc(agentRuns.createdAt))
      .all();
    return rows.map(toAgentRun);
  }

  insert(run: AgentRun): void {
    this.client.db
      .insert(agentRuns)
      .values({
        id: run.id,
        sessionId: run.session_id as string,
        tradeId: run.trade_id ?? null,
        agentType: run.agent_type,
        model: run.model,
        providerKey: run.provider_key,
        finishReason: run.finish_reason,
        inputTokens: run.input_tokens,
        outputTokens: run.output_tokens,
        costUsd: run.cost_usd,
        outputText: run.output_text,
        durationMs: run.duration_ms,
        createdAt: run.created_at,
      })
      .run();
  }
}
