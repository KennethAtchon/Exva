import { describe, expect, it } from "vitest";
import { WAIT_FOR_OPEN_REJECTION_REASON } from "../../../../risk/risk-engine";
import { riskGateInputBuilder } from "../trade-engine-input-builders";
import type { InstrumentAnalysisState } from "../../../analysis/types";

function baseState(): InstrumentAnalysisState {
  return {
    decision: {
      output: {
        symbol: "ETH",
        action: "buy",
        executionStrategy: "breakout",
        entryPrice: null,
        confidence: 0.65,
        reasoning: "Moderate conviction setup.",
      },
      run: { cost_usd: 0.01 } as never,
      message: {} as never,
    },
    executionProfile: {
      side: "BUY",
      positionSizeUsd: 500,
      limitPrice: null,
      stopLossPct: 2,
      takeProfitPct: 4,
    },
  };
}

describe("riskGateInputBuilder.applyOutput", () => {
  it("converts wait-for-open rejection into a skip decision instead of throwing", () => {
    const next = riskGateInputBuilder.applyOutput?.(baseState(), {
      allowed: false,
      reason: WAIT_FOR_OPEN_REJECTION_REASON,
    });

    expect(next?.decision?.output.action).toBe("skip");
    expect(next?.decision?.output.reasoning).toBe(
      WAIT_FOR_OPEN_REJECTION_REASON,
    );
    expect(next?.riskOrder).toBeUndefined();
    expect(next?.brokerAllocation).toBeUndefined();
  });

  it("still throws for other risk rejections", () => {
    expect(() =>
      riskGateInputBuilder.applyOutput?.(baseState(), {
        allowed: false,
        reason: "Max concurrent trades reached",
      }),
    ).toThrow("Max concurrent trades reached");
  });

  it("stores the risk order when allowed", () => {
    const order = {
      instrumentSymbol: "ETH",
      instrumentDisplayName: null,
      predictionOutcome: null,
      instrumentMetadataJson: null,
      instrumentType: "crypto" as const,
      side: "BUY" as const,
      sizeUsd: 500,
    };
    const next = riskGateInputBuilder.applyOutput?.(baseState(), {
      allowed: true,
      value: order,
    });

    expect(next?.riskOrder).toEqual(order);
    expect(next?.decision?.output.action).toBe("buy");
  });
});
