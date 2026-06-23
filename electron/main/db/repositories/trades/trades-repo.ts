import type { DbClient } from "../../client";
import type {
  ExecutionMode,
  InstrumentClass,
  Trade,
  TradeStatus,
} from "@/lib/types";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  like,
  lte,
  ne,
  sql,
} from "drizzle-orm";
import { agentMessages, sessions, trades } from "../../schema";
import { AppError } from "@electron/shared/infra/errors";
import { toTrade } from "../system/mappers";

export class TradesRepo {
  constructor(private readonly client: DbClient) {}

  listAll(sessionId?: string): Trade[] {
    const query = this.client.db
      .select()
      .from(trades)
      .orderBy(desc(trades.createdAt));
    const rows = sessionId
      ? query.where(eq(trades.sessionId, sessionId)).all()
      : query.all();
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

    if (filters.sessionId)
      conditions.push(eq(trades.sessionId, filters.sessionId));
    if (filters.brokerAccountId)
      conditions.push(eq(trades.brokerAccountId, filters.brokerAccountId));
    if (filters.symbolContains?.trim()) {
      conditions.push(
        like(
          sql`lower(${trades.instrumentSymbol})`,
          `%${filters.symbolContains.trim().toLowerCase()}%`,
        ),
      );
    }
    if (filters.instrumentType)
      conditions.push(eq(trades.instrumentType, filters.instrumentType));
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

    const query = this.client.db
      .select()
      .from(trades)
      .orderBy(desc(trades.createdAt));
    const rows = conditions.length
      ? query.where(and(...conditions)).all()
      : query.all();
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

  checkInstrumentConflict(
    brokerAccountId: string,
    instrumentSymbol: string,
    excludeSessionId: string,
  ): boolean {
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

  findOpenTradeOnBroker(
    brokerAccountId: string,
    instrumentSymbol: string,
    excludeSessionId: string,
  ): Trade | null {
    const row = this.client.db
      .select()
      .from(trades)
      .where(
        and(
          eq(trades.brokerAccountId, brokerAccountId),
          eq(trades.instrumentSymbol, instrumentSymbol),
          ne(trades.sessionId, excludeSessionId),
          eq(trades.status, "open"),
        ),
      )
      .orderBy(desc(trades.createdAt))
      .get();
    return row ? toTrade(row) : null;
  }

  sumOpenPositionSizeUsd(sessionId: string, brokerAccountId: string): number {
    const row = this.client.db
      .select({
        total: sql<number>`coalesce(sum(${trades.positionSizeUsd}), 0)`,
      })
      .from(trades)
      .where(
        and(
          eq(trades.sessionId, sessionId),
          eq(trades.brokerAccountId, brokerAccountId),
          eq(trades.status, "open"),
        ),
      )
      .get();
    return Number(row?.total ?? 0);
  }

  find(id: string): Trade | null {
    const row = this.client.db
      .select()
      .from(trades)
      .where(eq(trades.id, id))
      .get();
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
        executionStrategy: trade.execution_strategy ?? null,
        status: trade.status,
        openedAt: trade.opened_at,
        closedAt: trade.closed_at,
        finalPnlUsd: trade.final_pnl_usd,
        aiCostUsd: trade.ai_cost_usd,
        confidenceScore: trade.confidence_score,
        brokerOrderId: trade.broker_order_id,
        clientOrderId: trade.client_order_id ?? null,
        createdAt: trade.created_at,
      })
      .run();
  }

  checkDuplicateClientOrder(
    brokerAccountId: string,
    clientOrderId: string,
  ): boolean {
    const row = this.client.db
      .select({ count: sql<number>`count(*)` })
      .from(trades)
      .where(
        and(
          eq(trades.brokerAccountId, brokerAccountId),
          eq(trades.clientOrderId, clientOrderId),
          inArray(trades.status, ["open", "pending"]),
        ),
      )
      .get();
    return Number(row?.count ?? 0) > 0;
  }

  updateStatus(
    id: string,
    status: TradeStatus,
    finalPnlUsd: number | null = null,
    exitReason?: string,
  ): Trade {
    const current = this.require(id);
    const now = new Date().toISOString();
    this.client.db
      .update(trades)
      .set({
        status,
        closedAt:
          status === "closed" || status === "rejected" || status === "no_trade"
            ? now
            : current.closed_at,
        finalPnlUsd: finalPnlUsd ?? current.final_pnl_usd,
        ...(exitReason != null ? { exitReason } : {}),
      })
      .where(eq(trades.id, id))
      .run();
    return this.require(id);
  }

  updateHighWaterMark(tradeId: string, price: number): void {
    this.updatePriceExtremes(tradeId, price);
  }

  updatePriceExtremes(tradeId: string, price: number): void {
    this.client.db
      .update(trades)
      .set({ highWaterMarkPrice: price })
      .where(
        and(
          eq(trades.id, tradeId),
          sql`(${trades.highWaterMarkPrice} IS NULL OR ${trades.highWaterMarkPrice} < ${price})`,
        ),
      )
      .run();
    this.client.db
      .update(trades)
      .set({ lowWaterMarkPrice: price })
      .where(
        and(
          eq(trades.id, tradeId),
          sql`(${trades.lowWaterMarkPrice} IS NULL OR ${trades.lowWaterMarkPrice} > ${price})`,
        ),
      )
      .run();
  }

  updateExitAnalytics(
    id: string,
    analytics: {
      mfeUsd: number;
      maeUsd: number;
      commissionUsd?: number;
      borrowCostUsd?: number;
      executionCostUsd?: number;
      takeProfitTouchedAt?: string | null;
      stopTouchedAt?: string | null;
    },
  ): void {
    this.client.db
      .update(trades)
      .set({
        mfeUsd: analytics.mfeUsd,
        maeUsd: analytics.maeUsd,
        ...(analytics.commissionUsd != null
          ? { commissionUsd: analytics.commissionUsd }
          : {}),
        ...(analytics.borrowCostUsd != null
          ? { borrowCostUsd: analytics.borrowCostUsd }
          : {}),
        ...(analytics.executionCostUsd != null
          ? { executionCostUsd: analytics.executionCostUsd }
          : {}),
        ...(analytics.takeProfitTouchedAt !== undefined
          ? { takeProfitTouchedAt: analytics.takeProfitTouchedAt }
          : {}),
        ...(analytics.stopTouchedAt !== undefined
          ? { stopTouchedAt: analytics.stopTouchedAt }
          : {}),
      })
      .where(eq(trades.id, id))
      .run();
  }

  updateLevelTouchTimes(
    id: string,
    patch: {
      takeProfitTouchedAt?: string | null;
      stopTouchedAt?: string | null;
    },
  ): void {
    const next: Record<string, unknown> = {};
    if (patch.takeProfitTouchedAt !== undefined) {
      next.takeProfitTouchedAt = patch.takeProfitTouchedAt;
    }
    if (patch.stopTouchedAt !== undefined) {
      next.stopTouchedAt = patch.stopTouchedAt;
    }
    if (Object.keys(next).length === 0) return;
    this.client.db.update(trades).set(next).where(eq(trades.id, id)).run();
  }

  patchPendingExecution(
    id: string,
    patch: Partial<
      Pick<
        Trade,
        | "side"
        | "position_size_usd"
        | "confidence_score"
        | "brokerAccountId"
        | "client_order_id"
        | "entry_price"
        | "stop_loss_price"
        | "take_profit_price"
        | "execution_strategy"
      >
    >,
  ): void {
    const next: Record<string, unknown> = {};
    if (patch.side != null) next.side = patch.side;
    if (patch.position_size_usd != null)
      next.positionSizeUsd = patch.position_size_usd;
    if (patch.confidence_score != null)
      next.confidenceScore = patch.confidence_score;
    if (patch.entry_price !== undefined) next.entryPrice = patch.entry_price;
    if (patch.stop_loss_price !== undefined)
      next.stopLossPrice = patch.stop_loss_price;
    if (patch.take_profit_price !== undefined)
      next.takeProfitPrice = patch.take_profit_price;
    if (patch.execution_strategy !== undefined)
      next.executionStrategy = patch.execution_strategy;
    if (patch.brokerAccountId !== undefined)
      next.brokerAccountId = patch.brokerAccountId;
    if (patch.client_order_id !== undefined)
      next.clientOrderId = patch.client_order_id;
    if (Object.keys(next).length === 0) return;

    this.client.db
      .update(trades)
      .set(next)
      .where(and(eq(trades.id, id), eq(trades.status, "pending")))
      .run();
  }

  listClosed(sessionId: string): Trade[] {
    const rows = this.client.db
      .select()
      .from(trades)
      .where(and(eq(trades.sessionId, sessionId), eq(trades.status, "closed")))
      .orderBy(asc(trades.closedAt))
      .all();
    return rows.map(toTrade);
  }

  listClosedInWindow(filters: {
    sessionId?: string;
    sessionIds?: string[];
    windowStart: string;
    windowEnd: string;
    instrumentClasses?: string[];
    brokerAccountIds?: string[];
    outcome?: "all" | "winners" | "losers";
    minPositionSizeUsd?: number;
  }): Trade[] {
    const conditions = [
      eq(trades.status, "closed"),
      gte(trades.closedAt, filters.windowStart),
      lte(trades.closedAt, filters.windowEnd),
    ];

    if (filters.sessionId) {
      conditions.push(eq(trades.sessionId, filters.sessionId));
    } else if (filters.sessionIds?.length) {
      conditions.push(inArray(trades.sessionId, filters.sessionIds));
    }

    if (filters.instrumentClasses?.length) {
      conditions.push(
        inArray(trades.instrumentType, filters.instrumentClasses),
      );
    }
    if (filters.brokerAccountIds?.length) {
      conditions.push(
        inArray(trades.brokerAccountId, filters.brokerAccountIds),
      );
    }
    if (filters.outcome === "winners") {
      conditions.push(sql`${trades.finalPnlUsd} > 0`);
    } else if (filters.outcome === "losers") {
      conditions.push(sql`${trades.finalPnlUsd} < 0`);
    }
    if ((filters.minPositionSizeUsd ?? 0) > 0) {
      conditions.push(
        gte(trades.positionSizeUsd, filters.minPositionSizeUsd ?? 0),
      );
    }

    const rows = this.client.db
      .select()
      .from(trades)
      .where(and(...conditions))
      .orderBy(asc(trades.closedAt), asc(trades.createdAt))
      .all();
    return rows.map(toTrade);
  }

  listByIds(ids: string[]): Trade[] {
    if (ids.length === 0) return [];
    const rows = this.client.db
      .select()
      .from(trades)
      .where(inArray(trades.id, ids))
      .all();
    return rows.map(toTrade);
  }

  listByCycle(cycleId: string): Trade[] {
    const tradeIds = this.client.db
      .selectDistinct({ tradeId: agentMessages.tradeId })
      .from(agentMessages)
      .where(
        and(
          eq(agentMessages.cycleId, cycleId),
          sql`${agentMessages.tradeId} IS NOT NULL`,
        ),
      )
      .all()
      .map((r) => r.tradeId as string);
    if (tradeIds.length === 0) return [];
    const rows = this.client.db
      .select()
      .from(trades)
      .where(inArray(trades.id, tradeIds))
      .all();
    return rows.map(toTrade);
  }

  patchAiCost(id: string, costUsd: number): void {
    this.client.db
      .update(trades)
      .set({ aiCostUsd: costUsd })
      .where(eq(trades.id, id))
      .run();
  }

  markOpen(
    id: string,
    brokerOrderId: string,
    entryPrice: number,
    entryAnalytics?: {
      spreadAtEntryBps?: number | null;
      slippageBps?: number | null;
    },
    clientOrderId?: string,
  ): Trade {
    this.client.db
      .update(trades)
      .set({
        status: "open",
        brokerOrderId,
        entryPrice,
        openedAt: new Date().toISOString(),
        highWaterMarkPrice: entryPrice,
        lowWaterMarkPrice: entryPrice,
        ...(entryAnalytics?.spreadAtEntryBps != null
          ? { spreadAtEntryBps: entryAnalytics.spreadAtEntryBps }
          : {}),
        ...(entryAnalytics?.slippageBps != null
          ? { slippageBps: entryAnalytics.slippageBps }
          : {}),
        ...(clientOrderId != null ? { clientOrderId } : {}),
      })
      .where(eq(trades.id, id))
      .run();
    return this.require(id);
  }

  updateCloseSnapshot(id: string, closeMarketSnapshotJson: string): void {
    this.client.db
      .update(trades)
      .set({ closeMarketSnapshotJson })
      .where(eq(trades.id, id))
      .run();
  }
}
