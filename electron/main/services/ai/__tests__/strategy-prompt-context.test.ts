import { describe, expect, it } from "vitest";
import type { SessionStrategy } from "@electron/shared/domain";
import { buildStrategyTimeframeContext, prependStrategyHorizonToUserPrompt } from "../strategy-prompt-context";

function baseStrategy(overrides: Partial<SessionStrategy> = {}): SessionStrategy {
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
    primaryTradingTimeframe: "1h",
    holdingStyle: "multi_day_swing",
    targetHoldDays: 3,
    maxHoldDays: 10,
    timeframeNotes: "",
    ...overrides,
  };
}

describe("strategy-prompt-context", () => {
  it("truncates very long timeframe notes for AI prompts", () => {
    const long = "x".repeat(600);
    const text = buildStrategyTimeframeContext(baseStrategy({ timeframeNotes: long }));
    expect(text).toContain("…");
    expect(text.length).toBeLessThan(long.length + 200);
    expect(text).toContain("Primary timeframe");
  });

  it("prepends horizon before user content", () => {
    const out = prependStrategyHorizonToUserPrompt(
      baseStrategy({ primaryTradingTimeframe: "5m", holdingStyle: "intraday_flat" }),
      "Instrument: AAPL",
    );
    expect(out.startsWith("## Session trading horizon")).toBe(true);
    expect(out).toContain("5m");
    expect(out.endsWith("Instrument: AAPL")).toBe(true);
  });
});
