import { describe, expect, it } from "vitest";
import { AppError } from "@electron/shared/infra/errors";
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
      orderType: "market",
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

  it("maps concurrent-trade cap to a session-capacity outcome", () => {
    try {
      riskGateInputBuilder.applyOutput?.(baseState(), {
        allowed: false,
        reason: "Maximum concurrent trades reached",
      });
      throw new Error("expected risk gate to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).details).toMatchObject({
        outcome: "session_capacity",
        reasonCategory: "session_capacity",
      });
    }
  });

  it("maps spend guardrails to operator-required outcomes via gateType", () => {
    try {
      riskGateInputBuilder.applyOutput?.(baseState(), {
        allowed: false,
        reason: "Daily API budget reached",
        gateType: "api_budget",
      });
      throw new Error("expected risk gate to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).details).toMatchObject({
        outcome: "operator_required",
        reasonCategory: "session_spend_limit",
      });
    }
  });

  it("maps spend guardrails to operator-required outcomes", () => {
    try {
      riskGateInputBuilder.applyOutput?.(baseState(), {
        allowed: false,
        reason: "Daily API budget reached",
      });
      throw new Error("expected risk gate to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).details).toMatchObject({
        outcome: "operator_required",
        reasonCategory: "session_spend_limit",
      });
    }
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
