import type { DbClient } from "../client";
import type { InstrumentClass, TradeApproval, TradeSide } from "@/lib/types";
import { AppError } from "@electron/shared/errors";
import { toTradeApproval } from "./mappers";

export interface ApprovalListFilters {
  status?: "pending" | "approved" | "rejected";
  sessionIds?: string[];
  excludeArchivedSessions?: boolean;
}

export class TradeApprovalsRepo {
  constructor(private readonly client: DbClient) {}

  createPending(input: {
    sessionId: string;
    tradeId: string;
    brokerAccountId: string;
    instrumentSymbol: string;
    instrumentClass: InstrumentClass;
    proposedSide: TradeSide;
    proposedSizeUsd: number;
    decisionSummaryJson: string;
  }): TradeApproval {
    const id = crypto.randomUUID();
    const requestedAt = new Date().toISOString();
    this.client.sqlite
      .prepare(
        `
        INSERT INTO trade_approvals (
          id, session_id, trade_id, broker_account_id, instrument_symbol, instrument_class,
          proposed_side, proposed_size_usd, decision_summary_json, status, requested_at, resolved_at, decision_note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, NULL)
        `,
      )
      .run(
        id,
        input.sessionId,
        input.tradeId,
        input.brokerAccountId,
        input.instrumentSymbol,
        input.instrumentClass,
        input.proposedSide,
        input.proposedSizeUsd,
        input.decisionSummaryJson,
        requestedAt,
      );

    return this.require(id);
  }

  /** Full row insert (tests / migrations). */
  create(input: Omit<TradeApproval, "id">): TradeApproval {
    const id = crypto.randomUUID();
    this.client.sqlite
      .prepare(
        `
        INSERT INTO trade_approvals (
          id, session_id, trade_id, broker_account_id, instrument_symbol, instrument_class,
          proposed_side, proposed_size_usd, decision_summary_json, status, requested_at, resolved_at, decision_note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        id,
        input.sessionId,
        input.tradeId,
        input.brokerAccountId,
        input.instrumentSymbol,
        input.instrumentClass,
        input.proposedSide,
        input.proposedSizeUsd,
        input.decisionSummaryJson,
        input.status,
        input.requestedAt,
        input.resolvedAt,
        input.decisionNote,
      );

    return this.require(id);
  }

  listPending(): TradeApproval[] {
    return this.listAll({ status: "pending" });
  }

  listAll(filters: ApprovalListFilters): TradeApproval[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filters.status) {
      clauses.push("trade_approvals.status = ?");
      params.push(filters.status);
    }

    if (filters.sessionIds?.length) {
      const placeholders = filters.sessionIds.map(() => "?").join(", ");
      clauses.push(`trade_approvals.session_id IN (${placeholders})`);
      params.push(...filters.sessionIds);
    }

    let join = "";
    if (filters.excludeArchivedSessions) {
      join = " INNER JOIN sessions ON sessions.id = trade_approvals.session_id ";
      clauses.push("sessions.status != 'archived'");
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const sql = `SELECT trade_approvals.* FROM trade_approvals ${join} ${where} ORDER BY trade_approvals.requested_at DESC`;

    const rows = this.client.sqlite.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(toTradeApproval);
  }

  findPendingByTradeId(tradeId: string): TradeApproval | null {
    const row = this.client.sqlite
      .prepare("SELECT * FROM trade_approvals WHERE trade_id = ? AND status = 'pending'")
      .get(tradeId) as Record<string, unknown> | undefined;
    return row ? toTradeApproval(row) : null;
  }

  resolve(id: string, decision: "approved" | "rejected", note?: string): TradeApproval {
    const now = new Date().toISOString();
    const result = this.client.sqlite
      .prepare(
        `
        UPDATE trade_approvals
        SET status = ?, resolved_at = ?, decision_note = COALESCE(?, decision_note)
        WHERE id = ? AND status = 'pending'
        `,
      )
      .run(decision, now, note ?? null, id);

    if (result.changes === 0) {
      throw new AppError("Approval was not pending or was not found", "VALIDATION_FAILED", { id });
    }

    return this.require(id);
  }

  require(id: string): TradeApproval {
    const row = this.client.sqlite.prepare("SELECT * FROM trade_approvals WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) {
      throw new AppError(`Trade approval ${id} was not found`, "NOT_FOUND");
    }
    return toTradeApproval(row);
  }
}
