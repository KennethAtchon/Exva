import { describe, expect, it } from "vitest";
import { createTestDb } from "../test-helpers";
import { SessionRepo } from "./session-repo";
import { SessionStrategiesRepo } from "./session-strategies-repo";

describe("strategy schema migration compatibility", () => {
  it("seeds new strategy tables and renamed AI roles for new sessions", () => {
    const db = createTestDb();
    const repo = new SessionRepo(db);

    const session = repo.create({
      name: "Strategy Test",
      objective: "Validate strategy migration",
      selectionMode: "manual_shortlist",
      instrumentClasses: ["stock"],
      instrumentScope: "AAPL",
      capitalLimitUsd: 1000,
      executionMode: "paper_only",
    });

    const profile = db.sqlite.prepare("SELECT * FROM session_strategy_profile WHERE session_id = ?").get(session.id) as Record<string, unknown>;
    const risk = db.sqlite.prepare("SELECT * FROM session_risk_config WHERE session_id = ?").get(session.id) as Record<string, unknown>;
    const timeframe = db.sqlite.prepare("SELECT * FROM session_timeframe_config WHERE session_id = ?").get(session.id) as Record<string, unknown>;
    const roles = db.sqlite
      .prepare("SELECT role FROM session_ai_roles WHERE session_id = ? ORDER BY role ASC")
      .all(session.id) as Array<{ role: string }>;

    expect(profile.strategy_type).toBe("custom");
    expect(risk.max_position_usd).toBe(500);
    expect(risk.stop_loss_type).toBe("fixed_pct");
    expect(timeframe.primary_trading_timeframe).toBe("1d");
    expect(roles.map((row) => row.role)).toEqual([
      "analyst_fundamental",
      "analyst_technical",
      "decision_maker",
      "instrument_selector",
      "reviewer",
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
      capitalLimitUsd: 1000,
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

    const risk = db.sqlite.prepare("SELECT * FROM session_risk_config WHERE session_id = ?").get(session.id) as Record<string, unknown>;
    const timeframe = db.sqlite.prepare("SELECT * FROM session_timeframe_config WHERE session_id = ?").get(session.id) as Record<string, unknown>;

    expect(risk.max_position_usd).toBe(750);
    expect(risk.stop_loss_pct).toBe(1.5);
    expect(risk.take_profit_pct).toBe(5);
    expect(risk.max_concurrent_trades).toBe(4);
    expect(risk.daily_loss_limit_usd).toBe(300);
    expect(risk.profit_target_usd).toBe(1200);
    expect(risk.max_ai_spend_usd).toBe(7);
    expect(risk.human_approval_required).toBe(1);
    expect(timeframe.primary_trading_timeframe).toBe("4h");
    expect(timeframe.holding_style).toBe("weeks_position");
    expect(timeframe.target_hold_days).toBe(5);
    expect(timeframe.max_hold_days).toBe(12);
    expect(timeframe.timeframe_notes).toBe("Hold through multi-session swings.");

    db.sqlite.close();
  });
});
