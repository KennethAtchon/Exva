import type { DbClient } from "../client";
import type { ExecutionMode, InstrumentClass, Trade, TradeStatus } from "@/lib/types";
import { AppError } from "@electron/shared/errors";
import { toTrade } from "./mappers";

export class TradesRepo {
  constructor(private readonly client: DbClient) {}

  listAll(sessionId?: string): Trade[] {
    const rows = sessionId
      ? ((this.client.sqlite
          .prepare("SELECT * FROM trades WHERE session_id = ? ORDER BY created_at DESC")
          .all(sessionId) as Record<string, unknown>[]))
      : ((this.client.sqlite.prepare("SELECT * FROM trades ORDER BY created_at DESC").all() as Record<string, unknown>[]));
    return rows.map(toTrade);
  }

  /** Optional filters; `sessionId` when set restricts to that session (omit for all sessions). */
  listAllFiltered(filters: {
    sessionId?: string;
    brokerAccountId?: string;
    symbolContains?: string;
    instrumentType?: InstrumentClass;
    executionMode?: ExecutionMode;
  }): Trade[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filters.sessionId) {
      clauses.push("trades.session_id = ?");
      params.push(filters.sessionId);
    }
    if (filters.brokerAccountId) {
      clauses.push("trades.broker_account_id = ?");
      params.push(filters.brokerAccountId);
    }
    if (filters.symbolContains?.trim()) {
      clauses.push("LOWER(trades.instrument_symbol) LIKE ?");
      params.push(`%${filters.symbolContains.trim().toLowerCase()}%`);
    }
    if (filters.instrumentType) {
      clauses.push("trades.instrument_type = ?");
      params.push(filters.instrumentType);
    }
    if (filters.executionMode) {
      clauses.push("sessions.execution_mode = ?");
      params.push(filters.executionMode);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const needsSessionJoin = filters.executionMode != null;
    const from = needsSessionJoin
      ? "FROM trades INNER JOIN sessions ON sessions.id = trades.session_id"
      : "FROM trades";

    const sql = `
      SELECT trades.*
      ${from}
      ${where}
      ORDER BY trades.created_at DESC
    `;

    const rows = this.client.sqlite.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(toTrade);
  }

  listOpenAndPending(sessionId?: string): Trade[] {
    const rows = sessionId
      ? ((this.client.sqlite
          .prepare(
            "SELECT * FROM trades WHERE session_id = ? AND status IN ('open', 'pending') ORDER BY created_at DESC",
          )
          .all(sessionId) as Record<string, unknown>[]))
      : ((this.client.sqlite
          .prepare("SELECT * FROM trades WHERE status IN ('open', 'pending') ORDER BY created_at DESC")
          .all() as Record<string, unknown>[]));
    return rows.map(toTrade);
  }

  checkInstrumentConflict(brokerAccountId: string, instrumentSymbol: string, excludeSessionId: string): boolean {
    const row = this.client.sqlite
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM trades
        JOIN sessions ON sessions.id = trades.session_id
        WHERE trades.broker_account_id = ?
          AND trades.instrument_symbol = ?
          AND trades.session_id != ?
          AND trades.status IN ('open', 'pending')
          AND sessions.status IN ('active', 'paused')
        `,
      )
      .get(brokerAccountId, instrumentSymbol, excludeSessionId) as { count?: number } | undefined;

    return Number(row?.count ?? 0) > 0;
  }

  find(id: string): Trade | null {
    const row = this.client.sqlite
      .prepare("SELECT * FROM trades WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? toTrade(row) : null;
  }

  require(id: string): Trade {
    const trade = this.find(id);
    if (!trade) throw new AppError(`Trade ${id} was not found`, "NOT_FOUND");
    return trade;
  }

  insert(trade: Trade): void {
    this.client.sqlite
      .prepare(
        `
        INSERT INTO trades (
          id, session_id, broker_account_id, instrument_symbol, instrument_type, side,
          entry_price, position_size_usd, stop_loss_price, take_profit_price, strategy,
          status, opened_at, closed_at, final_pnl_usd, ai_cost_usd, confidence_score,
          broker_order_id, created_at
        ) VALUES (
          @id, @session_id, @broker_account_id, @instrument_symbol, @instrument_type, @side,
          @entry_price, @position_size_usd, @stop_loss_price, @take_profit_price, @strategy,
          @status, @opened_at, @closed_at, @final_pnl_usd, @ai_cost_usd, @confidence_score,
          @broker_order_id, @created_at
        )
        `,
      )
      .run({
        ...trade,
        session_id: trade.sessionId,
        broker_account_id: trade.brokerAccountId ?? null,
        instrument_symbol: trade.instrumentSymbol,
        instrument_type: trade.instrumentType,
      });
  }

  updateStatus(id: string, status: TradeStatus, finalPnlUsd: number | null = null): Trade {
    const now = new Date().toISOString();
    this.client.sqlite
      .prepare(
        `
        UPDATE trades SET
          status = @status,
          closed_at = CASE WHEN @status IN ('closed', 'rejected') THEN @now ELSE closed_at END,
          final_pnl_usd = COALESCE(@final_pnl_usd, final_pnl_usd)
        WHERE id = @id
        `,
      )
      .run({ id, status, now, final_pnl_usd: finalPnlUsd });
    return this.require(id);
  }

  patchPendingExecution(
    id: string,
    patch: Partial<Pick<Trade, "side" | "position_size_usd" | "confidence_score" | "brokerAccountId">>,
  ): void {
    const fields: string[] = [];
    const params: Record<string, unknown> = { id };

    if (patch.side != null) {
      fields.push("side = @side");
      params.side = patch.side;
    }
    if (patch.position_size_usd != null) {
      fields.push("position_size_usd = @position_size_usd");
      params.position_size_usd = patch.position_size_usd;
    }
    if (patch.confidence_score != null) {
      fields.push("confidence_score = @confidence_score");
      params.confidence_score = patch.confidence_score;
    }
    if (patch.brokerAccountId !== undefined) {
      fields.push("broker_account_id = @broker_account_id");
      params.broker_account_id = patch.brokerAccountId;
    }

    if (fields.length === 0) return;

    this.client.sqlite
      .prepare(
        `
        UPDATE trades SET
          ${fields.join(", ")}
        WHERE id = @id AND status = 'pending'
        `,
      )
      .run({
        ...params,
        id,
      });
  }

  markOpen(id: string, brokerOrderId: string, entryPrice: number): Trade {
    this.client.sqlite
      .prepare(
        `
        UPDATE trades SET
          status = 'open',
          broker_order_id = @broker_order_id,
          entry_price = @entry_price,
          opened_at = @opened_at
        WHERE id = @id
        `,
      )
      .run({
        id,
        broker_order_id: brokerOrderId,
        entry_price: entryPrice,
        opened_at: new Date().toISOString(),
      });
    return this.require(id);
  }
}
