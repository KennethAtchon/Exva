import type { DbClient } from "../client";
import type { ExecutionMode, InstrumentClass, Trade, TradeStatus } from "@/lib/types";
import { and, desc, eq, inArray, like, ne, sql } from "drizzle-orm";
import { sessions, trades } from "../schema";
import { AppError } from "@electron/shared/errors";
import { toTrade } from "./mappers";

export class TradesRepo {
  constructor(private readonly client: DbClient) {}

  listAll(sessionId?: string): Trade[] {
    const query = this.client.db.select().from(trades).orderBy(desc(trades.createdAt));
    const rows = sessionId ? query.where(eq(trades.sessionId, sessionId)).all() : query.all();
    return rows.map(toTrade);
  }

  listAllFiltered(filters: {
    sessionId?: string;
    brokerAccountId?: string;
    symbolContains?: string;
    instrumentType?: InstrumentClass;
    executionMode?: ExecutionMode;
  }): Trade[] {
    const conditions = [];

    if (filters.sessionId) conditions.push(eq(trades.sessionId, filters.sessionId));
    if (filters.brokerAccountId) conditions.push(eq(trades.brokerAccountId, filters.brokerAccountId));
    if (filters.symbolContains?.trim()) {
      conditions.push(like(sql`lower(${trades.instrumentSymbol})`, `%${filters.symbolContains.trim().toLowerCase()}%`));
    }
    if (filters.instrumentType) conditions.push(eq(trades.instrumentType, filters.instrumentType));
    if (filters.executionMode) {
      const sessionIds = this.client.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.executionMode, filters.executionMode))
        .all()
        .map((row) => row.id);
      if (sessionIds.length === 0) return [];
      conditions.push(inArray(trades.sessionId, sessionIds));
    }

    const query = this.client.db.select().from(trades).orderBy(desc(trades.createdAt));
    const rows = conditions.length ? query.where(and(...conditions)).all() : query.all();
    return rows.map(toTrade);
  }

  listOpenAndPending(sessionId?: string): Trade[] {
    const baseConditions = [inArray(trades.status, ["open", "pending"])];
    if (sessionId) baseConditions.push(eq(trades.sessionId, sessionId));
    const rows = this.client.db
      .select()
      .from(trades)
      .where(and(...baseConditions))
      .orderBy(desc(trades.createdAt))
      .all();
    return rows.map(toTrade);
  }

  checkInstrumentConflict(brokerAccountId: string, instrumentSymbol: string, excludeSessionId: string): boolean {
    const row = this.client.db
      .select({ count: sql<number>`count(*)` })
      .from(trades)
      .innerJoin(sessions, eq(sessions.id, trades.sessionId))
      .where(
        and(
          eq(trades.brokerAccountId, brokerAccountId),
          eq(trades.instrumentSymbol, instrumentSymbol),
          ne(trades.sessionId, excludeSessionId),
          inArray(trades.status, ["open", "pending"]),
          inArray(sessions.status, ["active", "paused"]),
        ),
      )
      .get();

    return Number(row?.count ?? 0) > 0;
  }

  find(id: string): Trade | null {
    const row = this.client.db.select().from(trades).where(eq(trades.id, id)).get();
    return row ? toTrade(row) : null;
  }

  require(id: string): Trade {
    const trade = this.find(id);
    if (!trade) throw new AppError(`Trade ${id} was not found`, "NOT_FOUND");
    return trade;
  }

  insert(trade: Trade): void {
    this.client.db
      .insert(trades)
      .values({
        id: trade.id,
        sessionId: trade.sessionId as string,
        brokerAccountId: trade.brokerAccountId ?? null,
        instrumentSymbol: trade.instrumentSymbol,
        instrumentDisplayName: trade.instrumentDisplayName ?? null,
        predictionOutcome: trade.predictionOutcome ?? null,
        instrumentMetadataJson: trade.instrumentMetadataJson ?? null,
        instrumentType: trade.instrumentType,
        side: trade.side,
        entryPrice: trade.entry_price,
        positionSizeUsd: trade.position_size_usd,
        stopLossPrice: trade.stop_loss_price,
        takeProfitPrice: trade.take_profit_price,
        strategy: trade.strategy,
        status: trade.status,
        openedAt: trade.opened_at,
        closedAt: trade.closed_at,
        finalPnlUsd: trade.final_pnl_usd,
        aiCostUsd: trade.ai_cost_usd,
        confidenceScore: trade.confidence_score,
        brokerOrderId: trade.broker_order_id,
        createdAt: trade.created_at,
      })
      .run();
  }

  updateStatus(id: string, status: TradeStatus, finalPnlUsd: number | null = null): Trade {
    const current = this.require(id);
    const now = new Date().toISOString();
    this.client.db
      .update(trades)
      .set({
        status,
        closedAt: status === "closed" || status === "rejected" ? now : current.closed_at,
        finalPnlUsd: finalPnlUsd ?? current.final_pnl_usd,
      })
      .where(eq(trades.id, id))
      .run();
    return this.require(id);
  }

  patchPendingExecution(
    id: string,
    patch: Partial<Pick<Trade, "side" | "position_size_usd" | "confidence_score" | "brokerAccountId">>,
  ): void {
    const next: Record<string, unknown> = {};
    if (patch.side != null) next.side = patch.side;
    if (patch.position_size_usd != null) next.positionSizeUsd = patch.position_size_usd;
    if (patch.confidence_score != null) next.confidenceScore = patch.confidence_score;
    if (patch.brokerAccountId !== undefined) next.brokerAccountId = patch.brokerAccountId;
    if (Object.keys(next).length === 0) return;

    this.client.db
      .update(trades)
      .set(next)
      .where(and(eq(trades.id, id), eq(trades.status, "pending")))
      .run();
  }

  patchAiCost(id: string, costUsd: number): void {
    this.client.db.update(trades).set({ aiCostUsd: costUsd }).where(eq(trades.id, id)).run();
  }

  markOpen(id: string, brokerOrderId: string, entryPrice: number): Trade {
    this.client.db
      .update(trades)
      .set({
        status: "open",
        brokerOrderId,
        entryPrice,
        openedAt: new Date().toISOString(),
      })
      .where(eq(trades.id, id))
      .run();
    return this.require(id);
  }
}
