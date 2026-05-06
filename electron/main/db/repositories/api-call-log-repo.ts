import type { ApiCallLogEntry } from "@/lib/types";
import type { DbClient } from "../client";

export class ApiCallLogRepo {
  constructor(private readonly client: DbClient) {}

  insert(entry: ApiCallLogEntry): void {
    this.client.sqlite
      .prepare(
        `
        INSERT INTO api_call_log (
          id, session_id, trade_id, cycle_id, provider, endpoint, call_type,
          credits_used, cost_usd, latency_ms, status, from_cache, created_at
        ) VALUES (
          @id, @session_id, @trade_id, @cycle_id, @provider, @endpoint, @call_type,
          @credits_used, @cost_usd, @latency_ms, @status, @from_cache, @created_at
        )
        `,
      )
      .run({
        ...entry,
        from_cache: entry.from_cache ? 1 : 0,
      });
  }
}
