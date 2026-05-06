import type { TradeAutopsy } from "@/lib/types";
import type { DbClient } from "../client";

export class TradeAutopsiesRepo {
  constructor(private readonly client: DbClient) {}

  listByTrade(tradeId: string): TradeAutopsy[] {
    const rows = this.client.sqlite
      .prepare("SELECT * FROM trade_autopsies WHERE trade_id = ? ORDER BY created_at DESC")
      .all(tradeId) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id),
      trade_id: String(row.trade_id),
      session_id: String(row.session_id),
      model_id: String(row.model_id),
      summary: String(row.summary),
      created_at: String(row.created_at),
      created_by: String(row.created_by),
    }));
  }

  insert(input: TradeAutopsy): void {
    this.client.sqlite
      .prepare(
        `
        INSERT INTO trade_autopsies (
          id, trade_id, session_id, model_id, summary, created_at, created_by
        ) VALUES (
          @id, @trade_id, @session_id, @model_id, @summary, @created_at, @created_by
        )
        `,
      )
      .run(input);
  }
}
