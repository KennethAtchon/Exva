import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import {
  createMinimalSession,
  insertBrokerAccount,
  insertTrade,
} from "../../test-fixtures";
import { CapitalReservationsRepo } from "./capital-reservations-repo";
import { TradeApprovalsRepo } from "./trade-approvals-repo";

describe("CapitalReservationsRepo", () => {
  it("reserves capital for approvals and orders", () => {
    const db = createTestDb();
    const repo = new CapitalReservationsRepo(db);
    const approvalsRepo = new TradeApprovalsRepo(db);
    const session = createMinimalSession(db);
    const broker = insertBrokerAccount(db, { id: "broker-1" });
    const trade = insertTrade(db, {
      id: "trade-1",
      sessionId: session.id,
      brokerAccountId: broker.id,
    });

    const approval = approvalsRepo.createPending({
      sessionId: session.id,
      tradeId: trade.id,
      brokerAccountId: broker.id,
      instrumentSymbol: "NVDA",
      instrumentClass: "stock",
      proposedSide: "BUY",
      proposedSizeUsd: 500,
      decisionSummaryJson: "{}",
    });

    const reserved = repo.reserveForApproval({
      sessionId: session.id,
      approvalId: approval.id,
      amountUsd: 500,
    });
    expect(reserved.status).toBe("reserved");
    expect(repo.sumActiveReservedUsd(session.id)).toBe(500);

    repo.convertApprovalToOpenOrder(approval.id, trade.id);
    expect(repo.listActiveBySession(session.id)[0]).toMatchObject({
      reason: "open_order",
      status: "consumed",
      tradeId: trade.id,
    });

    repo.releaseOnClose(trade.id);
    expect(repo.sumActiveReservedUsd(session.id)).toBe(0);

    db.sqlite.close();
  });
});
