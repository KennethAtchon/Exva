import { describe, expect, it, vi } from "vitest";
import type { OhlcvBar } from "../../broker/adapters/broker-adapter";
import { createRulesScheduledScan } from "./rules-scheduled-scan";

function bar(close: number, overrides: Partial<OhlcvBar> = {}): OhlcvBar {
  return {
    ts: overrides.ts ?? new Date().toISOString(),
    open: overrides.open ?? close,
    high: overrides.high ?? close,
    low: overrides.low ?? close,
    close,
    volume: overrides.volume ?? 1000,
  };
}

describe("createRulesScheduledScan", () => {
  it("returns [] on quiet mean-reversion (no extension)", async () => {
    const closes = Array.from({ length: 30 }, () => 100);
    const getBars = vi.fn().mockResolvedValue(closes.map((c) => bar(c)));
    const scan = createRulesScheduledScan({
      id: "rules-mean-reversion/spy-15m-meanrev",
      experienceId: "rules-mean-reversion",
      strategyId: "mean-reversion",
      symbol: "SPY",
      instrumentClass: "stock",
      analysisTimeframe: "1h",
      schedule: { cadence: "15m", marketHours: "24_7" },
      getBars,
    });

    const signals = await scan.run({
      sessionId: "",
      experienceId: "rules-mean-reversion",
      now: new Date("2026-07-11T15:00:00.000Z"),
      symbol: "SPY",
      instrumentClass: "stock",
      analysisTimeframe: "1h",
    });

    expect(signals).toEqual([]);
    expect(getBars).toHaveBeenCalledWith("SPY", "1h", 50);
  });

  it("emits scan_hit when mean-reversion finds an oversold setup", async () => {
    // Flat then deep drop → z well below -2
    const closes = [...Array.from({ length: 19 }, () => 100), 80];
    const getBars = vi.fn().mockResolvedValue(closes.map((c) => bar(c)));
    const scan = createRulesScheduledScan({
      id: "rules-mean-reversion/spy-15m-meanrev",
      experienceId: "rules-mean-reversion",
      strategyId: "mean-reversion",
      symbol: "SPY",
      instrumentClass: "stock",
      analysisTimeframe: "1h",
      schedule: { cadence: "15m", marketHours: "24_7" },
      getBars,
    });

    const signals = await scan.run({
      sessionId: "",
      experienceId: "rules-mean-reversion",
      now: new Date("2026-07-11T15:00:00.000Z"),
      symbol: "SPY",
      instrumentClass: "stock",
      analysisTimeframe: "1h",
    });

    expect(signals).toHaveLength(1);
    const sig = signals[0];
    expect(sig).toBeDefined();
    if (!sig) throw new Error("expected signal");
    expect(sig.kind).toBe("scan_hit");
    if (sig.kind !== "scan_hit") throw new Error("expected scan_hit");
    expect(sig.payload.proposedAction).toBe("buy");
    expect(sig.payload.strategyId).toBe("mean-reversion");
    expect(sig.payload.evidence.zScore).toBeLessThan(-2);
    expect(sig.payload.barWindowHash).toMatch(/^[a-f0-9]{16}$/);
    expect(sig.symbols).toEqual(["SPY"]);
    expect(sig.sourceId).toBe("rules-mean-reversion/spy-15m-meanrev");
  });

  it("returns [] for options-flow until chain data is wired", async () => {
    const getBars = vi.fn().mockResolvedValue([bar(100)]);
    const scan = createRulesScheduledScan({
      id: "options-flow/aapl",
      experienceId: "options-flow-edge",
      strategyId: "options-flow",
      symbol: "AAPL",
      instrumentClass: "options",
      analysisTimeframe: "15m",
      schedule: { cadence: "15m", marketHours: "regular" },
      getBars,
    });
    const signals = await scan.run({
      sessionId: "",
      experienceId: "options-flow-edge",
      now: new Date(),
      symbol: "AAPL",
      instrumentClass: "options",
      analysisTimeframe: "15m",
    });
    expect(signals).toEqual([]);
    expect(getBars).not.toHaveBeenCalled();
  });
});
