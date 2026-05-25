import type { DbClient } from "../../client";
import type { TradeAutopsyRecord } from "@electron/shared/domain/autopsy";
import { desc, eq } from "drizzle-orm";
import { tradeAutopsies } from "../../schema";

function toRecord(row: typeof tradeAutopsies.$inferSelect): TradeAutopsyRecord {
  return {
    id: row.id,
    tradeId: row.tradeId,
    sessionId: row.sessionId,
    modelId: row.modelId,
    summary: row.summary,
    summaryStructuredJson: row.summaryStructuredJson,
    phaseTracesJson: row.phaseTracesJson,
    qualityGrade: row.qualityGrade,
    qualityScore: row.qualityScore,
    isFallback: row.isFallback,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  };
}

export class TradeAutopsiesRepo {
  constructor(private readonly client: DbClient) {}

  listByTrade(tradeId: string): TradeAutopsyRecord[] {
    const rows = this.client.db
      .select()
      .from(tradeAutopsies)
      .where(eq(tradeAutopsies.tradeId, tradeId))
      .orderBy(desc(tradeAutopsies.createdAt))
      .all();
    return rows.map(toRecord);
  }

  findLatest(tradeId: string): TradeAutopsyRecord | null {
    const row = this.client.db
      .select()
      .from(tradeAutopsies)
      .where(eq(tradeAutopsies.tradeId, tradeId))
      .orderBy(desc(tradeAutopsies.createdAt))
      .get();
    return row ? toRecord(row) : null;
  }

  find(id: string): TradeAutopsyRecord | null {
    const row = this.client.db
      .select()
      .from(tradeAutopsies)
      .where(eq(tradeAutopsies.id, id))
      .get();
    return row ? toRecord(row) : null;
  }

  insert(
    record: Omit<TradeAutopsyRecord, "id"> & { id?: string },
  ): TradeAutopsyRecord {
    const id = record.id ?? crypto.randomUUID();
    this.client.db
      .insert(tradeAutopsies)
      .values({
        id,
        tradeId: record.tradeId,
        sessionId: record.sessionId,
        modelId: record.modelId,
        summary: record.summary,
        summaryStructuredJson: record.summaryStructuredJson,
        phaseTracesJson: record.phaseTracesJson,
        qualityGrade: record.qualityGrade,
        qualityScore: record.qualityScore,
        isFallback: record.isFallback,
        createdAt: record.createdAt,
        createdBy: record.createdBy,
      })
      .run();
    const created = this.find(id);
    if (!created) {
      throw new Error(`Failed to load inserted trade autopsy ${id}`);
    }
    return created;
  }
}
