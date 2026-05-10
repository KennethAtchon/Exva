import type { ApiCallLogEntry } from "@/lib/types";
import type { DbClient } from "../client";
import { apiCallLog } from "../schema";
import { and, asc, eq, sql } from "drizzle-orm";

export class ApiCallLogRepo {
  constructor(private readonly client: DbClient) {}

  insert(entry: ApiCallLogEntry): void {
    this.client.db
      .insert(apiCallLog)
      .values({
        id: entry.id,
        sessionId: entry.session_id,
        tradeId: entry.trade_id,
        cycleId: entry.cycle_id,
        provider: entry.provider,
        endpoint: entry.endpoint,
        callType: entry.call_type,
        creditsUsed: entry.credits_used,
        costUsd: entry.cost_usd,
        latencyMs: entry.latency_ms,
        status: entry.status,
        fromCache: entry.from_cache,
        createdAt: entry.created_at,
      })
      .run();
  }

  dailyDataSpendUsd(sessionId: string, date = new Date().toISOString().slice(0, 10)): number {
    const row = this.client.db
      .select({ total: sql<number>`coalesce(sum(${apiCallLog.costUsd}), 0)` })
      .from(apiCallLog)
      .where(and(eq(apiCallLog.sessionId, sessionId), sql`substr(${apiCallLog.createdAt}, 1, 10) = ${date}`))
      .get();
    return Number(row?.total ?? 0);
  }

  listByScope(filters: {
    sessionId: string;
    cycleId?: string | null;
    tradeId?: string | null;
  }): ApiCallLogEntry[] {
    const clauses = [eq(apiCallLog.sessionId, filters.sessionId)];
    if (filters.cycleId) clauses.push(eq(apiCallLog.cycleId, filters.cycleId));
    if (filters.tradeId) clauses.push(eq(apiCallLog.tradeId, filters.tradeId));

    const rows = this.client.db
      .select()
      .from(apiCallLog)
      .where(and(...clauses))
      .orderBy(asc(apiCallLog.createdAt))
      .all();

    return rows.map((entry) => ({
      id: entry.id,
      session_id: entry.sessionId,
      trade_id: entry.tradeId,
      cycle_id: entry.cycleId,
      provider: entry.provider,
      endpoint: entry.endpoint,
      call_type: entry.callType,
      credits_used: entry.creditsUsed,
      cost_usd: entry.costUsd,
      latency_ms: entry.latencyMs,
      status: entry.status,
      from_cache: entry.fromCache,
      created_at: entry.createdAt,
    }));
  }
}
