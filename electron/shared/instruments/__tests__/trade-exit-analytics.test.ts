import { describe, expect, it } from "vitest";
import {
  computeMfeMaeUsd,
  computeSlippageBps,
  spreadPctToBps,
} from "@electron/shared/instruments/trade-exit-analytics";

describe("trade-exit-analytics", () => {
  it("converts spread percent to bps", () => {
    expect(spreadPctToBps(0.1)).toBe(10);
  });

  it("computes positive slippage bps for buys filled above reference", () => {
    expect(
      computeSlippageBps({
        side: "BUY",
        referencePrice: 100,
        filledPrice: 100.2,
      }),
    ).toBeCloseTo(20, 5);
  });

  it("computes MFE and MAE for a long trade", () => {
    const result = computeMfeMaeUsd({
      side: "BUY",
      entryPrice: 100,
      positionSizeUsd: 1000,
      highWaterMarkPrice: 105,
      lowWaterMarkPrice: 98,
      exitPrice: 102,
    });
    expect(result.mfeUsd).toBeCloseTo(50, 5);
    expect(result.maeUsd).toBeCloseTo(20, 5);
  });
});
