import type { TradeAutopsy } from "@/lib/types";
import type { DbClient } from "../../client";
import { desc, eq } from "drizzle-orm";
import { tradeAutopsies } from "../../schema";

export class TradeAutopsiesRepo {
  constructor(private readonly client: DbClient) {}

  listByTrade(tradeId: string): TradeAutopsy[] {
    const rows = this.client.db
      .select()
      .from(tradeAutopsies)
      .where(eq(tradeAutopsies.tradeId, tradeId))
      .orderBy(desc(tradeAutopsies.createdAt))
      .all();
    return rows.map((row) => ({
      id: String(row.id),
      trade_id: String(row.tradeId),
      session_id: String(row.sessionId),
      model_id: String(row.modelId),
      summary: String(row.summary),
      created_at: String(row.createdAt),
      created_by: String(row.createdBy),
    }));
  }

  insert(input: TradeAutopsy): void {
    this.client.db
      .insert(tradeAutopsies)
      .values({
        id: input.id,
        tradeId: input.trade_id,
        sessionId: input.session_id,
        modelId: input.model_id,
        summary: input.summary,
        createdAt: input.created_at,
        createdBy: input.created_by,
      })
      .run();
  }
}
