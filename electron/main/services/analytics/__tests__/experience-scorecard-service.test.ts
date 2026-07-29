import { describe, expect, it } from "vitest";
import { ApiCallLogRepo } from "../../../db/repositories/system/api-call-log-repo";
import { BrokerAccountsRepo } from "../../../db/repositories/brokers/broker-accounts-repo";
import { SessionBrokerAssignmentsRepo } from "../../../db/repositories/sessions/session-broker-assignments-repo";
import { SessionRepo } from "../../../db/repositories/sessions/session-repo";
import { TradesRepo } from "../../../db/repositories/trades/trades-repo";
import {
  createMinimalSession,
  insertBrokerAccount,
  insertTrade,
} from "../../../db/test-fixtures";
import { createTestDb } from "../../../db/test-helpers";
import { listExperiences } from "../../../experiences";
import { ExperienceScorecardService } from "../experience-scorecard-service";

function makeScorecardService(db: ReturnType<typeof createTestDb>) {
  return new ExperienceScorecardService({
    trades: new TradesRepo(db),
    brokerAccounts: new BrokerAccountsRepo(db),
    brokerAssignments: new SessionBrokerAssignmentsRepo(db),
    session: new SessionRepo(db),
    apiCallLog: new ApiCallLogRepo(db),
  });
}

function seedPaperExperienceTrades(
  db: ReturnType<typeof createTestDb>,
  experienceId: string,
) {
  const broker = insertBrokerAccount(db, {
    id: "broker-alpaca",
    brokerType: "alpaca",
    mode: "paper",
    name: "Alpaca Paper",
  });
  const session = createMinimalSession(db, {
    experienceId,
    executionMode: "paper_only",
  });
  new SessionBrokerAssignmentsRepo(db).replaceAssignments(session.id, [
    { brokerAccountId: broker.id, allocatedUsd: 10_000 },
  ]);

  const pnls = [50, 50, -30, 50, -30, 50, -30, 50, -30, 50];
  for (const [index, pnl] of pnls.entries()) {
    insertTrade(db, {
      id: `trade-${experienceId}-${index}`,
      sessionId: session.id,
      brokerAccountId: broker.id,
      status: "closed",
      final_pnl_usd: pnl,
      opened_at: `2024-01-${String(index + 1).padStart(2, "0")}T09:00:00Z`,
      closed_at: `2024-01-${String(index + 1).padStart(2, "0")}T10:00:00Z`,
    });
  }

  const apiCallLog = new ApiCallLogRepo(db);
  apiCallLog.insert({
    id: `ai-${experienceId}`,
    session_id: session.id,
    trade_id: null,
    cycle_id: null,
    provider: "openrouter",
    endpoint: "chat",
    call_type: "ai",
    credits_used: 1,
    cost_usd: 5,
    latency_ms: 100,
    status: "ok",
    from_cache: false,
    created_at: "2024-01-10T12:00:00Z",
  });
  apiCallLog.insert({
    id: `data-${experienceId}`,
    session_id: session.id,
    trade_id: null,
    cycle_id: null,
    provider: "polygon",
    endpoint: "/v2/aggs",
    call_type: "data",
    credits_used: 1,
    cost_usd: 3,
    latency_ms: 80,
    status: "ok",
    from_cache: false,
    created_at: "2024-01-10T12:00:00Z",
  });

  return session;
}

describe("ExperienceScorecardService.generateForExperience", () => {
  it("aggregates PnL, costs, win rate, and walk-forward for an experience", () => {
    const db = createTestDb();
    seedPaperExperienceTrades(db, "edgar-catalyst");
    const scorecard =
      makeScorecardService(db).generateForExperience("edgar-catalyst");

    expect(scorecard.experienceId).toBe("edgar-catalyst");
    expect(scorecard.tradeCount).toBe(10);
    expect(scorecard.winCount).toBe(6);
    expect(scorecard.lossCount).toBe(4);
    expect(scorecard.winRate).toBeCloseTo(0.6);
    expect(scorecard.expectancy).toBeCloseTo(18);
    expect(scorecard.netPnlUsd).toBeCloseTo(180);
    expect(scorecard.totalAiSpendUsd).toBeCloseTo(5);
    expect(scorecard.totalDataSpendUsd).toBeCloseTo(3);
    expect(scorecard.netPnlAfterCostsUsd).toBeCloseTo(172);
    expect(scorecard.costPerTradeUsd).toBeCloseTo(0.8);
    expect(scorecard.promotionTier).toBe("paper");
    expect(scorecard.walkForward).not.toBeNull();
    expect(scorecard.walkForward?.splitIndex).toBe(7);

    db.sqlite.close();
  });

  it("excludes mock-broker trades from experience metrics", () => {
    const db = createTestDb();
    const mockBroker = insertBrokerAccount(db, { id: "broker-mock" });
    const session = createMinimalSession(db, {
      experienceId: "rules-mean-reversion",
      executionMode: "paper_only",
    });
    new SessionBrokerAssignmentsRepo(db).replaceAssignments(session.id, [
      { brokerAccountId: mockBroker.id, allocatedUsd: 5000 },
    ]);

    insertTrade(db, {
      id: "mock-trade",
      sessionId: session.id,
      brokerAccountId: mockBroker.id,
      status: "closed",
      final_pnl_usd: 999,
      opened_at: "2024-01-01T09:00:00Z",
      closed_at: "2024-01-01T10:00:00Z",
    });

    const scorecard = makeScorecardService(db).generateForExperience(
      "rules-mean-reversion",
    );

    expect(scorecard.tradeCount).toBe(0);
    expect(scorecard.netPnlUsd).toBe(0);
    expect(scorecard.promotionTier).toBe("scripted");

    db.sqlite.close();
  });

  it("returns empty scorecard with spend-only net PnL when no closed trades exist", () => {
    const db = createTestDb();
    const session = createMinimalSession(db, {
      experienceId: "rules-breakout",
    });
    new ApiCallLogRepo(db).insert({
      id: "ai-only",
      session_id: session.id,
      trade_id: null,
      cycle_id: null,
      provider: "openrouter",
      endpoint: "chat",
      call_type: "ai",
      credits_used: 1,
      cost_usd: 2,
      latency_ms: 50,
      status: "ok",
      from_cache: false,
      created_at: "2024-01-01T12:00:00Z",
    });

    const scorecard =
      makeScorecardService(db).generateForExperience("rules-breakout");

    expect(scorecard.tradeCount).toBe(0);
    expect(scorecard.walkForward).toBeNull();
    expect(scorecard.totalAiSpendUsd).toBeCloseTo(2);
    expect(scorecard.netPnlAfterCostsUsd).toBeCloseTo(-2);
    expect(scorecard.failedPromotionCriteria).toContain("minTradeCount");

    db.sqlite.close();
  });
});

describe("ExperienceScorecardService.generateAll", () => {
  it("returns one scorecard per registered experience", () => {
    const db = createTestDb();
    seedPaperExperienceTrades(db, "edgar-catalyst");
    const scorecards = makeScorecardService(db).generateAll();

    expect(scorecards.length).toBe(listExperiences().length);
    expect(scorecards.map((scorecard) => scorecard.experienceId)).toContain(
      "edgar-catalyst",
    );
    expect(
      scorecards.find(
        (scorecard) => scorecard.experienceId === "edgar-catalyst",
      )?.tradeCount,
    ).toBe(10);

    db.sqlite.close();
  });
});
