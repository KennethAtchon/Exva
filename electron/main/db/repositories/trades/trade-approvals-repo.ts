import type { DbClient } from "../../client";
import type { InstrumentClass, TradeApproval, TradeSide } from "@/lib/types";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { sessions, tradeApprovals } from "../../schema";
import { AppError } from "@electron/shared/infra/errors";
import { toTradeApproval } from "../system/mappers";

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
    instrumentDisplayName?: string | null;
    predictionOutcome?: TradeApproval["predictionOutcome"];
    instrumentMetadataJson?: string | null;
    instrumentClass: InstrumentClass;
    proposedSide: TradeSide;
    proposedSizeUsd: number;
    decisionSummaryJson: string;
  }): TradeApproval {
    const id = crypto.randomUUID();
    const requestedAt = new Date().toISOString();
    this.client.db
      .insert(tradeApprovals)
      .values({
        id,
        sessionId: input.sessionId,
        tradeId: input.tradeId,
        brokerAccountId: input.brokerAccountId,
        instrumentSymbol: input.instrumentSymbol,
        instrumentDisplayName: input.instrumentDisplayName ?? null,
        predictionOutcome: input.predictionOutcome ?? null,
        instrumentMetadataJson: input.instrumentMetadataJson ?? null,
        instrumentClass: input.instrumentClass,
        proposedSide: input.proposedSide,
        proposedSizeUsd: input.proposedSizeUsd,
        decisionSummaryJson: input.decisionSummaryJson,
        status: "pending",
        requestedAt,
        resolvedAt: null,
        decisionNote: null,
      })
      .run();

    return this.require(id);
  }

  create(input: Omit<TradeApproval, "id">): TradeApproval {
    const id = crypto.randomUUID();
    this.client.db
      .insert(tradeApprovals)
      .values({
        id,
        sessionId: input.sessionId,
        tradeId: input.tradeId,
        brokerAccountId: input.brokerAccountId,
        instrumentSymbol: input.instrumentSymbol,
        instrumentDisplayName: input.instrumentDisplayName,
        predictionOutcome: input.predictionOutcome,
        instrumentMetadataJson: input.instrumentMetadataJson,
        instrumentClass: input.instrumentClass,
        proposedSide: input.proposedSide,
        proposedSizeUsd: input.proposedSizeUsd,
        decisionSummaryJson: input.decisionSummaryJson,
        status: input.status,
        requestedAt: input.requestedAt,
        resolvedAt: input.resolvedAt,
        decisionNote: input.decisionNote,
      })
      .run();

    return this.require(id);
  }

  listPending(): TradeApproval[] {
    return this.listAll({ status: "pending" });
  }

  listAll(filters: ApprovalListFilters): TradeApproval[] {
    const conditions = [];
    if (filters.status) {
      conditions.push(eq(tradeApprovals.status, filters.status));
    }
    if (filters.sessionIds?.length) {
      conditions.push(inArray(tradeApprovals.sessionId, filters.sessionIds));
    }
    if (filters.excludeArchivedSessions) {
      const activeSessionIds = this.client.db
        .select({ id: sessions.id })
        .from(sessions)
        .where(ne(sessions.status, "archived"))
        .all()
        .map((row) => row.id);
      if (activeSessionIds.length === 0) return [];
      conditions.push(inArray(tradeApprovals.sessionId, activeSessionIds));
    }

    const query = this.client.db.select().from(tradeApprovals).orderBy(desc(tradeApprovals.requestedAt));
    const rows = conditions.length > 0 ? query.where(and(...conditions)).all() : query.all();
    return rows.map(toTradeApproval);
  }

  findPendingByTradeId(tradeId: string): TradeApproval | null {
    const row = this.client.db
      .select()
      .from(tradeApprovals)
      .where(and(eq(tradeApprovals.tradeId, tradeId), eq(tradeApprovals.status, "pending")))
      .get();
    return row ? toTradeApproval(row) : null;
  }

  resolve(id: string, decision: "approved" | "rejected", note?: string): TradeApproval {
    const now = new Date().toISOString();
    const result = this.client.db
      .update(tradeApprovals)
      .set({
        status: decision,
        resolvedAt: now,
        decisionNote: note ?? undefined,
      })
      .where(and(eq(tradeApprovals.id, id), eq(tradeApprovals.status, "pending")))
      .run();

    if (result.changes === 0) {
      throw new AppError("Approval was not pending or was not found", "VALIDATION_FAILED", { id });
    }

    return this.require(id);
  }

  require(id: string): TradeApproval {
    const row = this.client.db.select().from(tradeApprovals).where(eq(tradeApprovals.id, id)).get();
    if (!row) {
      throw new AppError(`Trade approval ${id} was not found`, "NOT_FOUND");
    }
    return toTradeApproval(row);
  }
}
