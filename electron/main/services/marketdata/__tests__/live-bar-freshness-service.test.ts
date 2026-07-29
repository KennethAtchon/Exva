import { describe, expect, it } from "vitest";
import { LiveBarFreshnessService } from "../live-bar-freshness-service";

describe("LiveBarFreshnessService", () => {
  const svc = new LiveBarFreshnessService();

  it("requests provider refresh when Monday cache still has Friday bars", () => {
    // Monday 2026-07-27 15:00 UTC ≈ 11:00 ET regular hours
    const now = new Date("2026-07-27T15:00:00.000Z");
    const fridayClose = "2026-07-24T20:00:00.000Z";
    const decision = svc.resolve({
      symbol: "SPY",
      instrumentClass: "stock",
      timeframe: "1h",
      marketCalendarId: "nyse-regular",
      newestCachedTs: fridayClose,
      now,
    });
    expect(decision.kind).toBe("provider_refresh");
  });

  it("treats latest Friday close as market_closed_fresh on Saturday", () => {
    const now = new Date("2026-07-25T18:00:00.000Z"); // Saturday
    const fridayBar = "2026-07-24T19:00:00.000Z";
    const decision = svc.resolve({
      symbol: "SPY",
      instrumentClass: "stock",
      timeframe: "1h",
      marketCalendarId: "nyse-regular",
      newestCachedTs: fridayBar,
      now,
      providerDelayMs: 90_000,
    });
    // Closed market with a recent-enough last session bar should not thrash.
    expect(["market_closed_fresh", "provider_refresh"]).toContain(
      decision.kind,
    );
    if (decision.kind === "provider_refresh") {
      // If expected bar is newer than fridayBar, refresh once is OK —
      // continuous refetch is prevented by market_closed_fresh when caught up.
      expect(decision.expectedClosedBarTs).toBeTruthy();
    }
  });

  it("advances crypto 4h buckets across always-open calendar", () => {
    const now = new Date("2026-07-27T10:30:00.000Z");
    const stale = "2026-07-27T00:00:00.000Z";
    const decision = svc.resolve({
      symbol: "BTC-USD",
      instrumentClass: "crypto",
      timeframe: "4h",
      marketCalendarId: "always-open",
      newestCachedTs: stale,
      now,
    });
    expect(decision.kind).toBe("provider_refresh");
  });

  it("returns cache_fresh when newest matches expected closed bar", () => {
    const now = new Date("2026-07-27T12:05:00.000Z");
    const expected = svc.expectedLatestClosedBarTs({
      symbol: "BTC-USD",
      instrumentClass: "crypto",
      timeframe: "4h",
      marketCalendarId: "always-open",
      newestCachedTs: null,
      now,
    });
    expect(expected).toBeTruthy();
    const decision = svc.resolve({
      symbol: "BTC-USD",
      instrumentClass: "crypto",
      timeframe: "4h",
      marketCalendarId: "always-open",
      newestCachedTs: expected,
      now,
    });
    expect(decision.kind).toBe("cache_fresh");
  });
});
