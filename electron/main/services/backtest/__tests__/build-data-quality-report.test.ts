import { describe, expect, it } from "vitest";
import {
  buildBacktestDataQualityReport,
  detectBarGaps,
} from "../build-data-quality-report";
import type { OhlcvBar } from "../../broker/adapters/broker-adapter";

function bars(startIso: string, count: number, stepMs: number): OhlcvBar[] {
  const start = Date.parse(startIso);
  return Array.from({ length: count }, (_, i) => ({
    ts: new Date(start + i * stepMs).toISOString(),
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 1000,
  }));
}

describe("buildBacktestDataQualityReport", () => {
  it("marks continuous hourly bars complete", () => {
    const windowStart = "2024-01-01T00:00:00.000Z";
    const windowEnd = "2024-01-01T09:00:00.000Z";
    const report = buildBacktestDataQualityReport({
      symbol: "SPY",
      timeframe: "1h",
      windowStart,
      windowEnd,
      bars: bars(windowStart, 10, 3_600_000),
      provider: "alpaca",
      feed: "iex",
    });
    expect(report.complete).toBe(true);
    expect(report.duplicateTimestamps).toBe(0);
    expect(report.missingIntervals).toHaveLength(0);
    expect(report.provider).toBe("alpaca");
    expect(report.feed).toBe("iex");
  });

  it("flags gaps and blocks completeness", () => {
    const windowStart = "2024-01-01T00:00:00.000Z";
    const windowEnd = "2024-01-01T05:00:00.000Z";
    const series = bars(windowStart, 6, 3_600_000);
    series.splice(3, 1);
    const report = buildBacktestDataQualityReport({
      symbol: "SPY",
      timeframe: "1h",
      windowStart,
      windowEnd,
      bars: series,
      provider: "manual",
    });
    expect(report.complete).toBe(false);
    expect(report.missingIntervals.length).toBeGreaterThan(0);
    expect(report.blockers.some((b) => b.startsWith("gaps:"))).toBe(true);
  });

  it("detects duplicate timestamps", () => {
    const windowStart = "2024-01-01T00:00:00.000Z";
    const windowEnd = "2024-01-01T03:00:00.000Z";
    const series = bars(windowStart, 4, 3_600_000);
    series[2] = { ...series[1]! };
    const report = buildBacktestDataQualityReport({
      symbol: "SPY",
      timeframe: "1h",
      windowStart,
      windowEnd,
      bars: series,
    });
    expect(report.duplicateTimestamps).toBe(1);
    expect(report.complete).toBe(false);
  });
});

describe("detectBarGaps", () => {
  it("ignores regular weekend gaps on daily bars", () => {
    const gaps = detectBarGaps(
      ["2024-01-05T21:00:00.000Z", "2024-01-08T21:00:00.000Z"],
      "1d",
    );
    expect(gaps).toHaveLength(0);
  });
});
