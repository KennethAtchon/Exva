import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import {
  createMinimalSession,
  insertBrokerAccount,
  insertTrade,
} from "../../test-fixtures";
import { TradeApprovalsRepo } from "./trade-approvals-repo";

describe("TradeApprovalsRepo", () => {
  it("creates pending approvals and resolves them", () => {
    const db = createTestDb();
    const repo = new TradeApprovalsRepo(db);
    const session = createMinimalSession(db);
    const broker = insertBrokerAccount(db, { id: "broker-1" });
    const trade = insertTrade(db, {
      id: "trade-1",
      sessionId: session.id,
      brokerAccountId: broker.id,
    });

    const pending = repo.createPending({
      sessionId: session.id,
      tradeId: trade.id,
      brokerAccountId: broker.id,
      instrumentSymbol: "NVDA",
      instrumentClass: "stock",
      proposedSide: "BUY",
      proposedSizeUsd: 500,
      decisionSummaryJson: '{"confidence":0.8}',
    });

    expect(repo.listPending()).toMatchObject([{ id: pending.id }]);
    expect(repo.findPendingByTradeId(trade.id)?.status).toBe("pending");

    const resolved = repo.resolve(pending.id, "approved", "Looks good");
    expect(resolved).toMatchObject({
      status: "approved",
      decisionNote: "Looks good",
    });

    db.sqlite.close();
  });
});
