import type { DbClient } from "../client";
import type { CapitalReservation } from "@/lib/types";
import { toCapitalReservation } from "./mappers";

export class CapitalReservationsRepo {
  constructor(private readonly client: DbClient) {}

  reserveForApproval(input: { sessionId: string; approvalId: string; amountUsd: number }): CapitalReservation {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    this.client.sqlite
      .prepare(
        `
        INSERT INTO capital_reservations (
          id, session_id, approval_id, trade_id, amount_usd, reason, status, created_at, released_at
        ) VALUES (?, ?, ?, NULL, ?, 'approval', 'reserved', ?, NULL)
        `,
      )
      .run(id, input.sessionId, input.approvalId, input.amountUsd, createdAt);

    return this.require(id);
  }

  convertApprovalToOpenOrder(approvalId: string, tradeId: string): void {
    this.client.sqlite
      .prepare(
        `
        UPDATE capital_reservations
        SET trade_id = ?, reason = 'open_order', status = 'consumed'
        WHERE approval_id = ? AND status = 'reserved'
        `,
      )
      .run(tradeId, approvalId);
  }

  releaseByApproval(approvalId: string): void {
    this.client.sqlite
      .prepare(
        `
        UPDATE capital_reservations
        SET status = 'released', released_at = ?
        WHERE approval_id = ? AND status IN ('reserved', 'consumed')
        `,
      )
      .run(new Date().toISOString(), approvalId);
  }

  sumActiveReservedUsd(): number {
    const row = this.client.sqlite
      .prepare("SELECT COALESCE(SUM(amount_usd), 0) AS total FROM capital_reservations WHERE status IN ('reserved', 'consumed')")
      .get() as { total?: number };
    return Number(row.total ?? 0);
  }

  private require(id: string): CapitalReservation {
    const row = this.client.sqlite
      .prepare("SELECT * FROM capital_reservations WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error(`Capital reservation ${id} was not found`);
    }
    return toCapitalReservation(row);
  }
}
