import { describe, expect, it } from "vitest";
import {
  buildStrategyTimeframeContext,
  canTransition,
  isSessionEditable,
  timeframeHoldMismatchWarning,
  validateSessionStrategyTimeframeFields,
  type SessionStrategy,
} from "../domain";

function baseStrategy(
  overrides: Partial<SessionStrategy> = {},
): SessionStrategy {
  return {
    sessionId: "s1",
    strategyProfile: "custom",
    maxPositionUsd: 100,
    stopLossPct: 2,
    takeProfitPct: 4,
    maxConcurrentTrades: 1,
    researchDepth: "balanced",
    dailyLossLimitUsd: 50,
    profitTargetUsd: 200,
    maxAiSpendUsd: 5,
    humanApprovalRequired: false,
    primaryTradingTimeframe: "1d",
    holdingStyle: "multi_day_swing",
    targetHoldDays: null,
    maxHoldDays: null,
    timeframeNotes: "",
    ...overrides,
  };
}

describe("domain session helpers", () => {
  it("rejects illegal session transitions", () => {
    expect(canTransition("archived", "active")).toBe(false);
    expect(canTransition("active", "archived")).toBe(false);
    expect(canTransition("idle", "paused")).toBe(false);
  });

  it("accepts legal session transitions", () => {
    expect(canTransition("draft", "idle")).toBe(true);
    expect(canTransition("draft", "active")).toBe(true);
    expect(canTransition("active", "paused")).toBe(true);
    expect(canTransition("stopped", "archived")).toBe(true);
    expect(canTransition("stopped", "active")).toBe(true);
  });

  it("locks active and paused sessions from edits", () => {
    expect(isSessionEditable("draft")).toBe(true);
    expect(isSessionEditable("idle")).toBe(true);
    expect(isSessionEditable("stopped")).toBe(true);
    expect(isSessionEditable("active")).toBe(false);
    expect(isSessionEditable("paused")).toBe(false);
    expect(isSessionEditable("archived")).toBe(false);
  });

  it("validates timeframe hold-day ordering", () => {
    expect(() =>
      validateSessionStrategyTimeframeFields(
        baseStrategy({ targetHoldDays: 10, maxHoldDays: 5 }),
      ),
    ).toThrow(/Max hold/);
    expect(() =>
      validateSessionStrategyTimeframeFields(
        baseStrategy({ targetHoldDays: -1 }),
      ),
    ).toThrow();
  });

  it("builds strategy timeframe context block", () => {
    const text = buildStrategyTimeframeContext(
      baseStrategy({
        primaryTradingTimeframe: "4h",
        holdingStyle: "weeks_position",
        targetHoldDays: 14,
        timeframeNotes: "No earnings week",
      }),
    );
    expect(text).toContain("4h");
    expect(text).toContain("weeks_position");
    expect(text).toContain("14");
    expect(text).toContain("No earnings week");
  });

  it("warns on intraday style with slow timeframe", () => {
    expect(
      timeframeHoldMismatchWarning(
        baseStrategy({
          holdingStyle: "intraday_flat",
          primaryTradingTimeframe: "5m",
        }),
      ),
    ).toBeNull();
    expect(
      timeframeHoldMismatchWarning(
        baseStrategy({
          holdingStyle: "intraday_flat",
          primaryTradingTimeframe: "1d",
        }),
      ),
    ).toMatch(/Intraday/);
  });
});
