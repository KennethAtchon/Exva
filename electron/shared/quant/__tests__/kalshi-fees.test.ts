import { describe, expect, it } from "vitest";
import {
  kalshiDefaultCommissionBps,
  kalshiFeeBpsAtPrice,
  kalshiMakerFeeUsd,
  kalshiTradingFeeUsd,
  roundUpToCent,
} from "../kalshi-fees";

describe("kalshi fees", () => {
  it("matches schedule at P=0.50 C=1 → $0.02", () => {
    expect(kalshiTradingFeeUsd({ contracts: 1, price: 0.5 })).toBe(0.02);
  });

  it("computes maker fee with lower coefficient", () => {
    expect(kalshiMakerFeeUsd(1, 0.5)).toBe(0.01);
  });

  it("rounds up to the next cent", () => {
    expect(roundUpToCent(0.011)).toBe(0.02);
    expect(roundUpToCent(0.02)).toBe(0.02);
  });

  it("expresses fee as bps of notional for cost model", () => {
    // $0.02 fee on $0.50 notional = 400 bps
    expect(kalshiFeeBpsAtPrice(0.5, 1)).toBe(400);
    expect(kalshiDefaultCommissionBps()).toBe(400);
  });
});
