import { describe, expect, it } from "vitest";
import {
  CorrelationExposureService,
  inferMarketRegime,
  resolveAssetGroup,
} from "../correlation-exposure-service";

describe("resolveAssetGroup", () => {
  it("maps instrument classes to asset groups", () => {
    expect(resolveAssetGroup("stock")).toBe("equities_beta");
    expect(resolveAssetGroup("crypto")).toBe("crypto");
    expect(resolveAssetGroup("futures")).toBe("commodities");
  });

  it("overrides to crypto for BTC and ETH symbols", () => {
    expect(resolveAssetGroup("stock", "BTCUSD")).toBe("crypto");
    expect(resolveAssetGroup("stock", "ETH-PERP")).toBe("crypto");
  });
});

describe("inferMarketRegime", () => {
  it("classifies calm markets as low volatility", () => {
    expect(inferMarketRegime({ spreadPct: 0.1, recentReturnPct: 0.01 })).toBe(
      "low_vol",
    );
  });

  it("classifies wide spreads and momentum as high volatility", () => {
    expect(inferMarketRegime({ spreadPct: 0.4, recentReturnPct: 0.2 })).toBe(
      "high_vol",
    );
  });
});

describe("CorrelationExposureService", () => {
  it("allows exposure within the regime-adjusted cap", () => {
    const service = new CorrelationExposureService({
      listOpenExposureByGroup: () => ({ equities_beta: 200 }),
      maxSameGroupExposureUsd: () => 1000,
    });

    expect(
      service.checkExposure({
        sessionId: "s1",
        instrumentClass: "stock",
        symbol: "AAPL",
        proposedSizeUsd: 300,
        spreadPct: 0.1,
      }),
    ).toEqual({ ok: true });
  });

  it("blocks exposure that would exceed the high-volatility cap", () => {
    const service = new CorrelationExposureService({
      listOpenExposureByGroup: () => ({ equities_beta: 400 }),
      maxSameGroupExposureUsd: () => 1000,
    });

    const result = service.checkExposure({
      sessionId: "s1",
      instrumentClass: "stock",
      symbol: "AAPL",
      proposedSizeUsd: 200,
      spreadPct: 0.5,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("asset_group_equities_beta_cap_high_vol");
    }
  });
});
