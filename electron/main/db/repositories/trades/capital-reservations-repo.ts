import type { DbClient } from "../../client";
import type { CapitalReservation } from "@/lib/types";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { capitalReservations } from "../../schema";
import { toCapitalReservation } from "../system/mappers";

export class CapitalReservationsRepo {
  constructor(private readonly client: DbClient) {}

  /** Run multi-step money writes on the shared SQLite connection atomically. */
  runInTransaction<T>(fn: () => T): T {
    return this.client.db.transaction(fn);
  }

  reserveForOrder(input: {
    sessionId: string;
    tradeId: string;
    amountUsd: number;
  }): CapitalReservation {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    this.client.db
      .insert(capitalReservations)
      .values({
        id,
        sessionId: input.sessionId,
        approvalId: null,
        tradeId: input.tradeId,
        amountUsd: input.amountUsd,
        reason: "open_order",
        status: "consumed",
        createdAt,
        releasedAt: null,
      })
      .run();

    return this.require(id);
  }

  reserveForApproval(input: {
    sessionId: string;
    approvalId: string;
    amountUsd: number;
  }): CapitalReservation {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    this.client.db
      .insert(capitalReservations)
      .values({
        id,
        sessionId: input.sessionId,
        approvalId: input.approvalId,
        tradeId: null,
        amountUsd: input.amountUsd,
        reason: "approval",
        status: "reserved",
        createdAt,
        releasedAt: null,
      })
      .run();

    return this.require(id);
  }

  convertApprovalToOpenOrder(approvalId: string, tradeId: string): void {
    this.client.db
      .update(capitalReservations)
      .set({ tradeId, reason: "open_order", status: "consumed" })
      .where(
        and(
          eq(capitalReservations.approvalId, approvalId),
          eq(capitalReservations.status, "reserved"),
        ),
      )
      .run();
  }

  releaseByApproval(approvalId: string): void {
    this.client.db
      .update(capitalReservations)
      .set({ status: "released", releasedAt: new Date().toISOString() })
      .where(
        and(
          eq(capitalReservations.approvalId, approvalId),
          inArray(capitalReservations.status, ["reserved", "consumed"]),
        ),
      )
      .run();
  }

  /** Adjust reserved amount when a fresh risk pass shrinks the intended order size. */
  updateReservedAmountForApproval(approvalId: string, amountUsd: number): void {
    this.client.db
      .update(capitalReservations)
      .set({ amountUsd })
      .where(
        and(
          eq(capitalReservations.approvalId, approvalId),
          eq(capitalReservations.status, "reserved"),
        ),
      )
      .run();
  }

  sumActiveReservedUsd(sessionId?: string): number {
    const condition = sessionId
      ? and(
          eq(capitalReservations.sessionId, sessionId),
          inArray(capitalReservations.status, ["reserved", "consumed"]),
        )
      : inArray(capitalReservations.status, ["reserved", "consumed"]);
    const row = this.client.db
      .select({
        total: sql<number>`coalesce(sum(${capitalReservations.amountUsd}), 0)`,
      })
      .from(capitalReservations)
      .where(condition)
      .get();
    return Number(row?.total ?? 0);
  }

  listActiveBySession(sessionId: string): CapitalReservation[] {
    const rows = this.client.db
      .select()
      .from(capitalReservations)
      .where(
        and(
          eq(capitalReservations.sessionId, sessionId),
          inArray(capitalReservations.status, ["reserved", "consumed"]),
        ),
      )
      .orderBy(asc(capitalReservations.createdAt))
      .all();
    return rows.map(toCapitalReservation);
  }

  convertOrderToPosition(tradeId: string): void {
    this.client.db
      .update(capitalReservations)
      .set({ reason: "open_position" })
      .where(
        and(
          eq(capitalReservations.tradeId, tradeId),
          eq(capitalReservations.status, "consumed"),
          eq(capitalReservations.reason, "open_order"),
        ),
      )
      .run();
  }

  releaseOnCancel(tradeId: string): void {
    const now = new Date().toISOString();
    this.client.db
      .update(capitalReservations)
      .set({ status: "released", releasedAt: now })
      .where(
        and(
          eq(capitalReservations.tradeId, tradeId),
          eq(capitalReservations.status, "consumed"),
          eq(capitalReservations.reason, "open_order"),
        ),
      )
      .run();
  }

  releaseOnFailure(tradeId: string): void {
    this.releaseOnCancel(tradeId);
  }

  releaseOnClose(tradeId: string): void {
    const now = new Date().toISOString();
    this.client.db
      .update(capitalReservations)
      .set({ status: "released", releasedAt: now })
      .where(
        and(
          eq(capitalReservations.tradeId, tradeId),
          eq(capitalReservations.status, "consumed"),
          inArray(capitalReservations.reason, ["open_order", "open_position"]),
        ),
      )
      .run();
  }

  private require(id: string): CapitalReservation {
    const row = this.client.db
      .select()
      .from(capitalReservations)
      .where(eq(capitalReservations.id, id))
      .get();
    if (!row) {
      throw new Error(`Capital reservation ${id} was not found`);
    }
    return toCapitalReservation(row);
  }
}
