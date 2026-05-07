import type { ApiCallLogEntry } from "@/lib/types";
import type { DbClient } from "../client";
import { apiCallLog } from "../schema";
import { and, eq, sql } from "drizzle-orm";

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
}
