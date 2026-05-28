import type { DbClient } from "../../client";
import type {
  AutopsyScope,
  PeriodAutopsyRecord,
} from "@electron/shared/domain/autopsy";
import { AppError } from "@electron/shared/infra/errors";
import { and, desc, eq, sql } from "drizzle-orm";
import { periodAutopsies } from "../../schema";

function toRecord(
  row: typeof periodAutopsies.$inferSelect,
): PeriodAutopsyRecord {
  return {
    id: row.id,
    scope: row.scope as AutopsyScope,
    sessionId: row.sessionId,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    modelId: row.modelId,
    filtersJson: row.filtersJson,
    tradeCount: row.tradeCount,
    tradeIdsJson: row.tradeIdsJson,
    summaryStructuredJson: row.summaryStructuredJson,
    phaseTracesJson: row.phaseTracesJson,
    qualityGrade: row.qualityGrade,
    qualityScore: row.qualityScore,
    isFallback: row.isFallback,
    totalCostUsd: row.totalCostUsd,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
  };
}

export class PeriodAutopsiesRepo {
  constructor(private readonly client: DbClient) {}

  listByScope(input: {
    scope: AutopsyScope;
    sessionId?: string | null;
    limit?: number;
    offset?: number;
  }): { items: PeriodAutopsyRecord[]; total: number } {
    const where = buildScopeWhere(input.scope, input.sessionId);
    const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
    const offset = Math.max(0, input.offset ?? 0);
    const rows = this.client.db
      .select()
      .from(periodAutopsies)
      .where(where)
      .orderBy(desc(periodAutopsies.createdAt))
      .limit(limit)
      .offset(offset)
      .all();
    const totalRow = this.client.db
      .select({ count: sql<number>`count(*)` })
      .from(periodAutopsies)
      .where(where)
      .get();
    return {
      items: rows.map(toRecord),
      total: Number(totalRow?.count ?? 0),
    };
  }

  find(id: string): PeriodAutopsyRecord | null {
    const row = this.client.db
      .select()
      .from(periodAutopsies)
      .where(eq(periodAutopsies.id, id))
      .get();
    return row ? toRecord(row) : null;
  }

  require(id: string): PeriodAutopsyRecord {
    const record = this.find(id);
    if (!record) {
      throw new AppError(`Period autopsy ${id} was not found`, "NOT_FOUND");
    }
    return record;
  }

  findLatestByScope(
    scope: AutopsyScope,
    sessionId?: string | null,
  ): PeriodAutopsyRecord | null {
    const row = this.client.db
      .select()
      .from(periodAutopsies)
      .where(buildScopeWhere(scope, sessionId))
      .orderBy(desc(periodAutopsies.createdAt))
      .get();
    return row ? toRecord(row) : null;
  }

  insert(
    record: Omit<PeriodAutopsyRecord, "id"> & { id?: string },
  ): PeriodAutopsyRecord {
    const id = record.id ?? crypto.randomUUID();
    this.client.db
      .insert(periodAutopsies)
      .values({
        id,
        scope: record.scope,
        sessionId: record.sessionId,
        windowStart: record.windowStart,
        windowEnd: record.windowEnd,
        modelId: record.modelId,
        filtersJson: record.filtersJson,
        tradeCount: record.tradeCount,
        tradeIdsJson: record.tradeIdsJson,
        summaryStructuredJson: record.summaryStructuredJson,
        phaseTracesJson: record.phaseTracesJson,
        qualityGrade: record.qualityGrade,
        qualityScore: record.qualityScore,
        isFallback: record.isFallback,
        totalCostUsd: record.totalCostUsd,
        createdAt: record.createdAt,
        createdBy: record.createdBy,
      })
      .run();
    return this.require(id);
  }
}

function buildScopeWhere(scope: AutopsyScope, sessionId?: string | null) {
  if (scope === "session") {
    if (!sessionId) {
      throw new AppError(
        "sessionId is required for session-scoped autopsy.",
        "VALIDATION_FAILED",
      );
    }
    return and(
      eq(periodAutopsies.scope, scope),
      eq(periodAutopsies.sessionId, sessionId),
    );
  }

  return and(
    eq(periodAutopsies.scope, scope),
    sql`${periodAutopsies.sessionId} IS NULL`,
  );
}
