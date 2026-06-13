import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import { CapitalReservationsRepo } from "../../../db/repositories/trades/capital-reservations-repo";
import { SessionRepo } from "../../../db/repositories/sessions/session-repo";
import { TradeApprovalsRepo } from "../../../db/repositories/trades/trade-approvals-repo";
import { TradesRepo } from "../../../db/repositories/trades/trades-repo";
import { CapitalReservationService } from "../capital-reservation-service";

describe("CapitalReservationService", () => {
  let db = createTestDb();

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.sqlite.close();
  });

  it("tracks reservation lifecycle from approval to close", () => {
    const service = new CapitalReservationService(
      new CapitalReservationsRepo(db),
    );
    const { sessionId, approvalId, tradeId } = createApprovalFixture(
      db,
      "Lifecycle",
    );

    service.reserveForApproval({ sessionId, approvalId, amountUsd: 300 });
    expect(service.sumActiveReservedUsd()).toBe(300);

    service.updateReservedAmountForApproval(approvalId, 250);
    expect(service.sumActiveReservedUsd()).toBe(250);

    service.convertApprovalToOpenOrder(approvalId, tradeId);
    service.convertOrderToPosition(tradeId);
    expect(service.listActiveBySession(sessionId)).toHaveLength(1);

    service.releaseOnClose(tradeId);
    expect(service.sumActiveReservedUsd()).toBe(0);
    expect(service.listActiveBySession(sessionId)).toEqual([]);
  });

  it("releases direct order reservations on failure", () => {
    const service = new CapitalReservationService(
      new CapitalReservationsRepo(db),
    );
    const { sessionId, tradeId } = createApprovalFixture(db, "Failure");

    service.reserveForOrder({ sessionId, tradeId, amountUsd: 125 });
    expect(service.sumActiveReservedUsd()).toBe(125);

    service.releaseOnFailure(tradeId);
    expect(service.sumActiveReservedUsd()).toBe(0);
  });
});

function createApprovalFixture(
  db: ReturnType<typeof createTestDb>,
  name: string,
) {
  const sessions = new SessionRepo(db);
  const sessionId = sessions.create({
    name: `${name} Session`,
    objective: "Reserve capital",
    selectionMode: "manual_shortlist",
    instrumentClasses: ["stock"],
    instrumentScope: "AAPL",
    executionMode: "paper_only",
  }).id;

  const tradeId = `trade-${name.toLowerCase()}`;
  new TradesRepo(db).insert({
    id: tradeId,
    sessionId,
    brokerAccountId: null,
    instrumentSymbol: "AAPL",
    instrumentDisplayName: "Apple",
    predictionOutcome: null,
    instrumentMetadataJson: null,
    instrumentType: "stock",
    side: "BUY",
    entry_price: null,
    position_size_usd: 200,
    stop_loss_price: null,
    take_profit_price: null,
    strategy: "swing",
    status: "pending",
    opened_at: null,
    closed_at: null,
    final_pnl_usd: null,
    ai_cost_usd: 0,
    confidence_score: 0.8,
    broker_order_id: null,
    high_water_mark_price: null,
    low_water_mark_price: null,
    exit_reason: null,
    created_at: new Date().toISOString(),
  });

  const approval = new TradeApprovalsRepo(db).createPending({
    sessionId,
    tradeId,
    brokerAccountId: "broker-1",
    instrumentSymbol: "AAPL",
    instrumentDisplayName: "Apple",
    instrumentClass: "stock",
    proposedSide: "BUY",
    proposedSizeUsd: 200,
    decisionSummaryJson: "{}",
  });

  return { sessionId, tradeId, approvalId: approval.id };
}
