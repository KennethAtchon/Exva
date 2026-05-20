import { describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import {
  sessionAiPhases,
  sessionResearchPosture,
  sessionRiskConfig,
  sessionTimeframeConfig,
  sessionTradeRules,
} from "../../schema";
import { createTestDb } from "../../test-helpers";
import { SessionRepo } from "./session-repo";
import { SessionStrategiesRepo } from "./session-strategies-repo";

describe("strategy schema migration compatibility", () => {
  it("seeds new strategy tables and AI phase configs for new sessions", () => {
    const db = createTestDb();
    const repo = new SessionRepo(db);

    const session = repo.create({
      name: "Strategy Test",
      objective: "Validate strategy migration",
      selectionMode: "manual_shortlist",
      instrumentClasses: ["stock"],
      instrumentScope: "AAPL",
      executionMode: "paper_only",
    });

    const posture = db.db
      .select()
      .from(sessionResearchPosture)
      .where(eq(sessionResearchPosture.sessionId, session.id))
      .get();
    const rules = db.db
      .select()
      .from(sessionTradeRules)
      .where(eq(sessionTradeRules.sessionId, session.id))
      .get();
    const risk = db.db
      .select()
      .from(sessionRiskConfig)
      .where(eq(sessionRiskConfig.sessionId, session.id))
      .get();
    const timeframe = db.db
      .select()
      .from(sessionTimeframeConfig)
      .where(eq(sessionTimeframeConfig.sessionId, session.id))
      .get();
    const phases = db.db
      .select({ phase: sessionAiPhases.phase })
      .from(sessionAiPhases)
      .where(eq(sessionAiPhases.sessionId, session.id))
      .orderBy(asc(sessionAiPhases.phase))
      .all();

    expect(posture?.posturePresetId).toBe("trend_hunt");
    expect(rules?.setupType).toBe("breakout");
    expect(risk?.maxPositionUsd).toBe(500);
    expect(risk?.stopLossType).toBe("trailing_atr");
    expect(timeframe?.primaryTradingTimeframe).toBe("4h");
    expect(phases.map((row) => row.phase)).toEqual([
      "decision",
      "fundamental",
      "review",
      "selector",
      "technical",
    ]);

    db.sqlite.close();
  });

  it("mirrors legacy SessionStrategiesRepo updates into the new risk and timeframe tables", () => {
    const db = createTestDb();
    const sessions = new SessionRepo(db);
    const strategies = new SessionStrategiesRepo(db);

    const session = sessions.create({
      name: "Mirror Test",
      objective: "Ensure compatibility writes stay in sync",
      selectionMode: "manual_shortlist",
      instrumentClasses: ["stock"],
      instrumentScope: "MSFT",
      executionMode: "paper_only",
    });

    strategies.update(session.id, {
      maxPositionUsd: 750,
      stopLossPct: 1.5,
      takeProfitPct: 5,
      maxConcurrentTrades: 4,
      dailyLossLimitUsd: 300,
      profitTargetUsd: 1200,
      maxAiSpendUsd: 7,
      humanApprovalRequired: true,
      primaryTradingTimeframe: "4h",
      holdingStyle: "weeks_position",
      targetHoldDays: 5,
      maxHoldDays: 12,
      timeframeNotes: "Hold through multi-session swings.",
    });

    const risk = db.db
      .select()
      .from(sessionRiskConfig)
      .where(eq(sessionRiskConfig.sessionId, session.id))
      .get();
    const timeframe = db.db
      .select()
      .from(sessionTimeframeConfig)
      .where(eq(sessionTimeframeConfig.sessionId, session.id))
      .get();

    expect(risk?.maxPositionUsd).toBe(750);
    expect(risk?.stopLossPct).toBe(1.5);
    expect(risk?.takeProfitPct).toBe(5);
    expect(risk?.maxConcurrentTrades).toBe(4);
    expect(risk?.dailyLossLimitUsd).toBe(300);
    expect(risk?.profitTargetUsd).toBe(1200);
    expect(risk?.maxAiSpendUsd).toBe(7);
    expect(risk?.humanApprovalRequired).toBe(true);
    expect(timeframe?.primaryTradingTimeframe).toBe("4h");
    expect(timeframe?.holdingStyle).toBe("weeks_position");
    expect(timeframe?.targetHoldDays).toBe(5);
    expect(timeframe?.maxHoldDays).toBe(12);
    expect(timeframe?.timeframeNotes).toBe(
      "Hold through multi-session swings.",
    );

    db.sqlite.close();
  });
});
