import type { DbClient } from "../client";
import type { TradeApproval } from "@/lib/types";
import { toTradeApproval } from "./mappers";

export class TradeApprovalsRepo {
  constructor(private readonly client: DbClient) {}

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

  require(id: string): TradeApproval {
    const row = this.client.sqlite.prepare("SELECT * FROM trade_approvals WHERE id = ?").get(id) as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error(`Trade approval ${id} was not found`);
    }
    return toTradeApproval(row);
  }
}
