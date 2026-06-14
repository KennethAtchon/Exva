import { describe, expect, it } from "vitest";
import { catalystTradeDecisionInputBuilder } from "../catalyst-decision-input-builders";

describe("catalystTradeDecisionInputBuilder", () => {
  const analystPayload = {
    kind: "catalyst-analyst",
    executionStrategy: "breakout",
    action: "buy",
    confidence: 0.8,
    entryTiming: "now",
    catalystStrength: 0.7,
    priceReactionScore: 0.6,
    reasoning: "Strong filing catalyst with supportive tape.",
  };

  it("aggregates fundamental and review outputs into a synthetic decision run", async () => {
    const built = await catalystTradeDecisionInputBuilder.build({
      planCtx: {
        sessionId: "s1",
        instrument: { symbol: "ACME" },
        strategyContext: {
          riskConfig: { waitForOpenThreshold: 0.5 },
        },
      } as never,
      state: {
        fundamental: {
          output: {
            rawSummary: JSON.stringify(analystPayload),
          },
        },
        review: {
          output: {
            symbol: "ACME",
            recommendation: "proceed",
            contradictionRisk: 0.2,
            overallRisk: "low",
            rawSummary: "No major contradictions.",
          },
        },
      } as never,
    });

    expect(
      (built.task as { signal: { action: string; symbol: string } }).signal
        .action,
    ).toBe("buy");
    expect(
      (built.task as { signal: { action: string; symbol: string } }).signal
        .symbol,
    ).toBe("ACME");
    expect(built.statePatch?.decision?.output.action).toBe("buy");
    expect(built.statePatch?.decision?.run.provider_key).toBe(
      "catalyst-two-call",
    );
  });

  it("requires both fundamental and review outputs", async () => {
    await expect(
      catalystTradeDecisionInputBuilder.build({
        planCtx: { sessionId: "s1", instrument: { symbol: "ACME" } } as never,
        state: { fundamental: { output: { rawSummary: "{}" } } } as never,
      }),
    ).rejects.toThrow(/requires fundamental and review/);
  });
});
