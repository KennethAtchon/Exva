import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isMarketOpen,
  SessionScheduler,
  type ScheduledScan,
} from "./session-scheduler";

describe("isMarketOpen", () => {
  it("always returns true for 24_7", () => {
    // Saturday morning UTC — regular/extended would be closed
    const saturday = new Date("2026-07-11T14:00:00.000Z");
    expect(isMarketOpen("24_7", saturday)).toBe(true);
    expect(isMarketOpen("regular", saturday)).toBe(false);
  });
});

describe("SessionScheduler quiet tick", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits nothing when the scan returns an empty list", async () => {
    const onSignals = vi.fn();
    const scheduler = new SessionScheduler(onSignals);
    const quietScan: ScheduledScan = {
      id: "scan-quiet",
      experienceId: "rules-mean-reversion",
      schedule: { cadence: "15m", marketHours: "24_7" },
      symbol: "SPY",
      instrumentClass: "stock",
      analysisTimeframe: "1h",
      run: async () => [],
    };
    scheduler.register(quietScan);

    const tel = await scheduler.fireNow("scan-quiet");
    expect(tel).toMatchObject({
      scanId: "scan-quiet",
      hitCount: 0,
      quiet: true,
      skippedMarketClosed: false,
    });
    expect(onSignals).not.toHaveBeenCalled();
    scheduler.stop();
  });
});
