/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, expect, it } from "vitest";
import {
  selectVerticalSpread,
  strikeFromOcc,
  verticalMaxLoss,
  creditVerticalMaxLoss,
} from "../vertical-spread-selector";
import type { OptionContract } from "../option-contract-selector";

function contract(
  overrides: Partial<OptionContract> & Pick<OptionContract, "symbol" | "delta">,
): OptionContract {
  return {
    type: "call",
    openInterest: 2000,
    bid: 2,
    ask: 2.2,
    daysToExpiry: 30,
    ...overrides,
  };
}

describe("vertical spread selector", () => {
  it("parses OCC strike", () => {
    expect(strikeFromOcc("AAPL250117C00150000")).toBe(150);
    expect(strikeFromOcc("AAPL250117C00155000")).toBe(155);
  });

  it("selects a debit call vertical", () => {
    const chain: OptionContract[] = [
      contract({
        symbol: "AAPL250117C00150000",
        delta: 0.45,
        bid: 3.0,
        ask: 3.2,
      }),
      contract({
        symbol: "AAPL250117C00155000",
        delta: 0.3,
        bid: 1.5,
        ask: 1.7,
      }),
      contract({
        symbol: "AAPL250117C00160000",
        delta: 0.18,
        bid: 0.7,
        ask: 0.85,
      }),
    ];
    const result = selectVerticalSpread(chain, "buy");
    expect(result.spread).not.toBeNull();
    expect(result.spread!.structure).toBe("vertical");
    expect(result.spread!.maxLoss).toBe(result.spread!.netDebit);
    expect(verticalMaxLoss(result.spread!.netDebit)).toBe(
      result.spread!.netDebit,
    );
  });

  it("credit vertical max loss is width minus credit", () => {
    expect(creditVerticalMaxLoss(5, 1.5)).toBe(3.5);
  });
});
