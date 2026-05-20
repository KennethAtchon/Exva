import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import { agentRuns, trades } from "../../schema";
import { SessionRepo } from "../sessions/session-repo";
import { StatsRepo } from "./stats-repo";

describe("StatsRepo", () => {
  it("counts daily AI spend from agent runs even before a trade exists", () => {
    const db = createTestDb();
    const session = createSession(db, "Spend Session");
    const today = new Date().toISOString();

    db.db
      .insert(agentRuns)
      .values({
        id: "run-selector",
        sessionId: session.id,
        tradeId: null,
        agentType: "selector",
        model: "openai/gpt-4o-mini",
        providerKey: "provider-openrouter",
        finishReason: "stop",
        inputTokens: 1200,
        outputTokens: 300,
        costUsd: 1.25,
        outputText: "picked candidates",
        durationMs: 2500,
        createdAt: today,
      })
      .run();

    const stats = new StatsRepo(db).dashboardStats(
      session.id,
      "active",
      10_000,
      5,
      5,
    );

    expect(stats.total_trades_today).toBe(0);
    expect(stats.daily_api_spend).toBeCloseTo(1.25, 6);

    db.sqlite.close();
  });

  it("scopes cost breakdown to the requested session and today's runs", () => {
    const db = createTestDb();
    const repo = new StatsRepo(db);
    const sessionA = createSession(db, "Session A");
    const sessionB = createSession(db, "Session B");
    const today = new Date().toISOString();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    insertTrade(db, {
      id: "trade-a",
      sessionId: sessionA.id,
      instrumentSymbol: "NVDA",
      createdAt: today,
    });
    insertTrade(db, {
      id: "trade-b",
      sessionId: sessionB.id,
      instrumentSymbol: "TSLA",
      createdAt: today,
    });

    insertRun(db, {
      id: "run-a-selector",
      sessionId: sessionA.id,
      tradeId: null,
      agentType: "selector",
      costUsd: 0.5,
      createdAt: today,
    });
    insertRun(db, {
      id: "run-a-trade",
      sessionId: sessionA.id,
      tradeId: "trade-a",
      agentType: "technical",
      costUsd: 0.75,
      createdAt: today,
    });
    insertRun(db, {
      id: "run-a-history",
      sessionId: sessionA.id,
      tradeId: "trade-a",
      agentType: "technical",
      costUsd: 0.3,
      createdAt: yesterday,
    });
    insertRun(db, {
      id: "run-b-other-session",
      sessionId: sessionB.id,
      tradeId: "trade-b",
      agentType: "technical",
      costUsd: 2,
      createdAt: today,
    });

    const breakdown = repo.costBreakdown({
      sessionId: sessionA.id,
      dateRange: "today",
    });

    expect(breakdown.total).toBeCloseTo(1.25, 6);
    expect(breakdown.by_agent).toMatchObject([
      { name: "technical", cost: 0.75 },
      { name: "selector", cost: 0.5 },
    ]);
    expect(breakdown.by_trade).toMatchObject([
      { instrumentSymbol: "NVDA", cost: 0.75 },
    ]);
    expect(breakdown.daily_history).toEqual([
      { date: yesterday.slice(0, 10), cost: 0.3 },
      { date: today.slice(0, 10), cost: 1.25 },
    ]);

    db.sqlite.close();
  });
});

function createSession(db: ReturnType<typeof createTestDb>, name: string) {
  return new SessionRepo(db).create({
    name,
    objective: `${name} objective`,
    selectionMode: "manual_shortlist",
    instrumentClasses: ["stock"],
    instrumentScope: "Large-cap equities",
    executionMode: "paper_only",
  });
}

function insertTrade(
  db: ReturnType<typeof createTestDb>,
  input: {
    id: string;
    sessionId: string;
    instrumentSymbol: string;
    createdAt: string;
  },
) {
  db.db
    .insert(trades)
    .values({
      id: input.id,
      sessionId: input.sessionId,
      brokerAccountId: null,
      instrumentSymbol: input.instrumentSymbol,
      instrumentDisplayName: null,
      predictionOutcome: null,
      instrumentMetadataJson: null,
      instrumentType: "stock",
      side: "BUY",
      entryPrice: null,
      positionSizeUsd: 500,
      stopLossPrice: null,
      takeProfitPrice: null,
      strategy: "passive_income",
      status: "pending",
      openedAt: null,
      closedAt: null,
      finalPnlUsd: null,
      aiCostUsd: 0,
      confidenceScore: 0.7,
      brokerOrderId: null,
      highWaterMarkPrice: null,
      exitReason: null,
      clientOrderId: null,
      closeMarketSnapshotJson: null,
      createdAt: input.createdAt,
    })
    .run();
}

function insertRun(
  db: ReturnType<typeof createTestDb>,
  input: {
    id: string;
    sessionId: string;
    tradeId: string | null;
    agentType: "technical" | "selector";
    costUsd: number;
    createdAt: string;
  },
) {
  db.db
    .insert(agentRuns)
    .values({
      id: input.id,
      sessionId: input.sessionId,
      tradeId: input.tradeId,
      agentType: input.agentType,
      model: "openai/gpt-4o-mini",
      providerKey: "provider-openrouter",
      finishReason: "stop",
      inputTokens: 1000,
      outputTokens: 250,
      costUsd: input.costUsd,
      outputText: "done",
      durationMs: 1000,
      createdAt: input.createdAt,
    })
    .run();
}
