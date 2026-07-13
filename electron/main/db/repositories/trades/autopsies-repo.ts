import type { DbClient } from "../../client";
import type {
  AutopsyScope,
  PeriodAutopsyRecord,
  TradeAutopsyRecord,
} from "@electron/shared/domain/autopsy";
import { AppError } from "@electron/shared/infra/errors";
import { and, desc, eq, sql } from "drizzle-orm";
import { autopsies } from "../../schema";

type AutopsyRow = typeof autopsies.$inferSelect;

function toTradeRecord(row: AutopsyRow): TradeAutopsyRecord {
  if (row.scope !== "trade") {
    throw new AppError(
      `Autopsy ${row.id} is not a trade autopsy`,
      "VALIDATION_FAILED",
    );
  }
  if (!row.tradeId || !row.sessionId || row.summary == null) {
    throw new AppError(
      `Trade autopsy ${row.id} is missing required fields`,
      "VALIDATION_FAILED",
    );
  }
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

function toPeriodRecord(row: AutopsyRow): PeriodAutopsyRecord {
  if (row.scope !== "period") {
    throw new AppError(
      `Autopsy ${row.id} is not a period autopsy`,
      "VALIDATION_FAILED",
    );
  }
  if (
    !row.periodScope ||
    !row.windowStart ||
    !row.windowEnd ||
    row.filtersJson == null ||
    row.tradeCount == null ||
    row.tradeIdsJson == null ||
    row.totalCostUsd == null
  ) {
    throw new AppError(
      `Period autopsy ${row.id} is missing required fields`,
      "VALIDATION_FAILED",
    );
  }
  return {
    id: row.id,
    scope: row.periodScope as AutopsyScope,
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

export class AutopsiesRepo {
  constructor(private readonly client: DbClient) {}

  listByTrade(tradeId: string): TradeAutopsyRecord[] {
    const rows = this.client.db
      .select()
      .from(autopsies)
      .where(and(eq(autopsies.scope, "trade"), eq(autopsies.tradeId, tradeId)))
      .orderBy(desc(autopsies.createdAt))
      .all();
    return rows.map(toTradeRecord);
  }

  findLatestByTrade(tradeId: string): TradeAutopsyRecord | null {
    const row = this.client.db
      .select()
      .from(autopsies)
      .where(and(eq(autopsies.scope, "trade"), eq(autopsies.tradeId, tradeId)))
      .orderBy(desc(autopsies.createdAt))
      .get();
    return row ? toTradeRecord(row) : null;
  }

  /** @deprecated Prefer findLatestByTrade — kept for call-site continuity. */
  findLatest(tradeId: string): TradeAutopsyRecord | null {
    return this.findLatestByTrade(tradeId);
  }

  findTrade(id: string): TradeAutopsyRecord | null {
    const row = this.client.db
      .select()
      .from(autopsies)
      .where(and(eq(autopsies.id, id), eq(autopsies.scope, "trade")))
      .get();
    return row ? toTradeRecord(row) : null;
  }

  insertTrade(
    record: Omit<TradeAutopsyRecord, "id"> & { id?: string },
  ): TradeAutopsyRecord {
    const id = record.id ?? crypto.randomUUID();
    this.client.db
      .insert(autopsies)
      .values({
        id,
        scope: "trade",
        tradeId: record.tradeId,
        summary: record.summary,
        periodScope: null,
        windowStart: null,
        windowEnd: null,
        filtersJson: null,
        tradeCount: null,
        tradeIdsJson: null,
        totalCostUsd: null,
        sessionId: record.sessionId,
        modelId: record.modelId,
        summaryStructuredJson: record.summaryStructuredJson,
        phaseTracesJson: record.phaseTracesJson,
        qualityGrade: record.qualityGrade,
        qualityScore: record.qualityScore,
        isFallback: record.isFallback,
        createdAt: record.createdAt,
        createdBy: record.createdBy,
      })
      .run();
    const created = this.findTrade(id);
    if (!created) {
      throw new Error(`Failed to load inserted trade autopsy ${id}`);
    }
    return created;
  }

  listPeriod(input: {
    scope: AutopsyScope;
    sessionId?: string | null;
    limit?: number;
    offset?: number;
  }): { items: PeriodAutopsyRecord[]; total: number } {
    const where = buildPeriodScopeWhere(input.scope, input.sessionId);
    const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
    const offset = Math.max(0, input.offset ?? 0);
    const rows = this.client.db
      .select()
      .from(autopsies)
      .where(where)
      .orderBy(desc(autopsies.createdAt))
      .limit(limit)
      .offset(offset)
      .all();
    const totalRow = this.client.db
      .select({ count: sql<number>`count(*)` })
      .from(autopsies)
      .where(where)
      .get();
    return {
      items: rows.map(toPeriodRecord),
      total: Number(totalRow?.count ?? 0),
    };
  }

  /** Alias for listPeriod. */
  listByScope(input: {
    scope: AutopsyScope;
    sessionId?: string | null;
    limit?: number;
    offset?: number;
  }): { items: PeriodAutopsyRecord[]; total: number } {
    return this.listPeriod(input);
  }

  findPeriod(id: string): PeriodAutopsyRecord | null {
    const row = this.client.db
      .select()
      .from(autopsies)
      .where(and(eq(autopsies.id, id), eq(autopsies.scope, "period")))
      .get();
    return row ? toPeriodRecord(row) : null;
  }

  requirePeriod(id: string): PeriodAutopsyRecord {
    const record = this.findPeriod(id);
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
      .from(autopsies)
      .where(buildPeriodScopeWhere(scope, sessionId))
      .orderBy(desc(autopsies.createdAt))
      .get();
    return row ? toPeriodRecord(row) : null;
  }

  insertPeriod(
    record: Omit<PeriodAutopsyRecord, "id"> & { id?: string },
  ): PeriodAutopsyRecord {
    const id = record.id ?? crypto.randomUUID();
    this.client.db
      .insert(autopsies)
      .values({
        id,
        scope: "period",
        tradeId: null,
        summary: null,
        periodScope: record.scope,
        windowStart: record.windowStart,
        windowEnd: record.windowEnd,
        filtersJson: record.filtersJson,
        tradeCount: record.tradeCount,
        tradeIdsJson: record.tradeIdsJson,
        totalCostUsd: record.totalCostUsd,
        sessionId: record.sessionId,
        modelId: record.modelId,
        summaryStructuredJson: record.summaryStructuredJson,
        phaseTracesJson: record.phaseTracesJson,
        qualityGrade: record.qualityGrade,
        qualityScore: record.qualityScore,
        isFallback: record.isFallback,
        createdAt: record.createdAt,
        createdBy: record.createdBy,
      })
      .run();
    return this.requirePeriod(id);
  }
}

function buildPeriodScopeWhere(scope: AutopsyScope, sessionId?: string | null) {
  if (scope === "session") {
    if (!sessionId) {
      throw new AppError(
        "sessionId is required for session-scoped autopsy.",
        "VALIDATION_FAILED",
      );
    }
    return and(
      eq(autopsies.scope, "period"),
      eq(autopsies.periodScope, scope),
      eq(autopsies.sessionId, sessionId),
    );
  }

  return and(
    eq(autopsies.scope, "period"),
    eq(autopsies.periodScope, scope),
    sql`${autopsies.sessionId} IS NULL`,
  );
}
