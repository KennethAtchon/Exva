import { describe, expect, it } from "vitest";
import { computeAtr } from "../atr";

describe("computeAtr", () => {
  it("returns null until it has a previous close plus one full period", () => {
    expect(
      computeAtr(
        Array.from({ length: 14 }, () => ({ high: 11, low: 9, close: 10 })),
      ),
    ).toBeNull();
  });

  it("calculates Wilder true ranges from high, low, and prior close", () => {
    const bars = [
      { high: 10, low: 10, close: 10 },
      { high: 12, low: 10, close: 11 },
      { high: 15, low: 13, close: 14 },
      { high: 14, low: 11, close: 12 },
    ];

    // True ranges are 2, 4, and 3; period-three ATR is their mean.
    expect(computeAtr(bars, 3)).toBeCloseTo(3);
  });
});
