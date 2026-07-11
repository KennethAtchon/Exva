import { describe, expect, it } from "vitest";
import { computeOptionsFlowSignal } from "./options-flow-signal";

const base = {
  underlyingSymbol: "NVDA",
  callOpenInterest: 1000,
  putOpenInterest: 1000,
  ivPercentile: 0.6,
  volumeOiRatioThreshold: 2,
  bullishSkewThreshold: 0.6,
};

describe("computeOptionsFlowSignal", () => {
  it("skips when volume/OI is not unusual", () => {
    const signal = computeOptionsFlowSignal({
      ...base,
      callVolume: 500,
      putVolume: 500,
    });
    expect(signal.action).toBe("skip");
    expect(signal.reasoning).toContain("not unusual");
  });

  it("buys on unusual bullish call flow", () => {
    const signal = computeOptionsFlowSignal({
      ...base,
      callVolume: 8000,
      putVolume: 1000,
    });
    expect(signal.action).toBe("buy");
    expect(signal.executionStrategy).toBe("options_flow");
    expect(signal.confidence).toBeGreaterThan(0.45);
    expect(signal.confidence).toBeLessThanOrEqual(0.85);
  });

  it("sells (buys puts) on unusual bearish put flow", () => {
    const signal = computeOptionsFlowSignal({
      ...base,
      callVolume: 1000,
      putVolume: 8000,
    });
    expect(signal.action).toBe("sell");
  });

  it("skips unusual-but-balanced flow (no directional read)", () => {
    const signal = computeOptionsFlowSignal({
      ...base,
      callVolume: 5000,
      putVolume: 5000,
    });
    expect(signal.action).toBe("skip");
    expect(signal.reasoning).toContain("balanced");
  });

  it("skips when there is no volume at all", () => {
    const signal = computeOptionsFlowSignal({
      ...base,
      callVolume: 0,
      putVolume: 0,
    });
    expect(signal.action).toBe("skip");
    expect(signal.confidence).toBe(0.2);
  });
});
