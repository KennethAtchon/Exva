import type { ApiCallLogEntry } from "@/lib/types";
import type { DbClient } from "../client";
import { apiCallLog } from "../schema";

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
}
