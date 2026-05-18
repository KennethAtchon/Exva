import type { DbClient } from "../../client";
import type { AgentRun } from "@/lib/types";
import { asc, eq } from "drizzle-orm";
import { agentMessages, agentRuns } from "../../schema";
import { toAgentRun } from "../system/mappers";

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

  listByCycle(cycleId: string): AgentRun[] {
    const rows = this.client.db
      .select({
        id: agentRuns.id,
        sessionId: agentRuns.sessionId,
        tradeId: agentRuns.tradeId,
        cycleId: agentMessages.cycleId,
        agentType: agentRuns.agentType,
        model: agentRuns.model,
        providerKey: agentRuns.providerKey,
        finishReason: agentRuns.finishReason,
        inputTokens: agentRuns.inputTokens,
        outputTokens: agentRuns.outputTokens,
        costUsd: agentRuns.costUsd,
        outputText: agentRuns.outputText,
        durationMs: agentRuns.durationMs,
        createdAt: agentRuns.createdAt,
      })
      .from(agentMessages)
      .innerJoin(agentRuns, eq(agentMessages.agentRunId, agentRuns.id))
      .where(eq(agentMessages.cycleId, cycleId))
      .orderBy(asc(agentRuns.createdAt))
      .all();

    const seen = new Set<string>();
    return rows
      .filter((row) => {
        if (seen.has(row.id)) return false;
        seen.add(row.id);
        return true;
      })
      .map((row) => toAgentRun(row));
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
