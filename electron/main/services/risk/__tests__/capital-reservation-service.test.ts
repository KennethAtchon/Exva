import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import { CapitalReservationsRepo } from "../../../db/repositories/capital-reservations-repo";
import { SessionRepo } from "../../../db/repositories/session-repo";
import { TradeApprovalsRepo } from "../../../db/repositories/trade-approvals-repo";
import { TradesRepo } from "../../../db/repositories/trades-repo";
import { WorkspacePreferencesRepo } from "../../../db/repositories/workspace-prefs-repo";
import { CapitalReservationService } from "../capital-reservation-service";

describe("CapitalReservationService", () => {
  let db = createTestDb();

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.sqlite.close();
  });

  it("enforces the shared global capital pool ceiling", () => {
    const prefs = new WorkspacePreferencesRepo(db);
    prefs.update({
      capitalAllocationMode: "shared_global_pool",
      globalCapitalPoolUsd: 1000,
    });

    const service = new CapitalReservationService(
      new CapitalReservationsRepo(db),
      prefs,
    );
    const { sessionId, approvalId } = createApprovalFixture(db, "Alpha");
    service.reserveForApproval({ sessionId, approvalId, amountUsd: 400 });

    expect(service.checkSessionStartFits("s2", 500)).toEqual({ ok: true });
    expect(service.checkSessionStartFits("s2", 700)).toEqual({
      ok: false,
      reserved: 400,
      ceiling: 1000,
    });
  });

  it("tracks reservation lifecycle from approval to close", () => {
    const service = new CapitalReservationService(
      new CapitalReservationsRepo(db),
      new WorkspacePreferencesRepo(db),
    );
    const { sessionId, approvalId, tradeId } = createApprovalFixture(db, "Lifecycle");

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
});

function createApprovalFixture(db: ReturnType<typeof createTestDb>, name: string) {
  const sessions = new SessionRepo(db);
  const sessionId = sessions.create({
    name: `${name} Session`,
    objective: "Reserve capital",
    selectionMode: "manual_shortlist",
    instrumentClasses: ["stock"],
    instrumentScope: "AAPL",
    capitalLimitUsd: 1000,
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
