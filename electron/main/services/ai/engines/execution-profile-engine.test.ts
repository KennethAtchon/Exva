import { describe, expect, it } from "vitest";
import { computeExecutionProfile } from "./execution-profile-engine";

describe("execution profile engine", () => {
  it("uses maxPositionUsd when no maxExposureUsd cap", () => {
    const profile = computeExecutionProfile({
      instrumentClass: "stock",
      action: "buy",
      maxPositionUsd: 1000,
      maxExposureUsd: null,
    });

    expect(profile.positionSizeUsd).toBe(1000);
    expect(profile.side).toBe("BUY");
  });

  it("caps at maxExposureUsd when it is lower than maxPositionUsd", () => {
    const profile = computeExecutionProfile({
      instrumentClass: "prediction_market",
      action: "buy",
      maxPositionUsd: 5000,
      maxExposureUsd: 500,
    });

    expect(profile.positionSizeUsd).toBe(500);
    expect(profile.side).toBe("BUY");
  });

  it("uses maxPositionUsd when maxExposureUsd is higher", () => {
    const profile = computeExecutionProfile({
      instrumentClass: "crypto",
      action: "buy",
      maxPositionUsd: 1000,
      maxExposureUsd: 10000,
    });

    expect(profile.positionSizeUsd).toBe(1000);
  });

  it("returns SELL side for sell action", () => {
    const profile = computeExecutionProfile({
      instrumentClass: "stock",
      action: "sell",
      maxPositionUsd: 2000,
      maxExposureUsd: null,
    });

    expect(profile.side).toBe("SELL");
    expect(profile.positionSizeUsd).toBe(2000);
  });

  it("applies cap to futures with maxExposureUsd", () => {
    const profile = computeExecutionProfile({
      instrumentClass: "futures",
      action: "buy",
      maxPositionUsd: 10000,
      maxExposureUsd: 3000,
    });

    expect(profile.positionSizeUsd).toBe(3000);
    expect(profile.side).toBe("BUY");
  });
});
