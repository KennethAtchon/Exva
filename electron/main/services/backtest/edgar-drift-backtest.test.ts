import { describe, expect, it } from "vitest";
import {
  computeConfidenceCalibration,
  computeForwardReturns,
  summarizeByItemCode,
  type FilingRecord,
  type OhlcvBar,
} from "./edgar-drift-backtest";

function barsFromCloses(
  closes: number[],
  startDate = "2024-01-02",
): OhlcvBar[] {
  return closes.map((close, i) => {
    const d = new Date(startDate);
    d.setUTCDate(d.getUTCDate() + i);
    return {
      date: d.toISOString(),
      open: close,
      high: close,
      low: close,
      close,
      volume: 1_000_000,
    };
  });
}

describe("edgar-drift-backtest", () => {
  it("computes forward returns from entry bar", () => {
    const filing: FilingRecord = {
      accessionNumber: "0001",
      ticker: "NVDA",
      filedAt: "2024-01-02T00:00:00.000Z",
      itemCodes: ["2.02"],
    };
    const bars = barsFromCloses([100, 102, 105, 110, 108, 112]);
    const result = computeForwardReturns(filing, bars, 0);
    if (!result) {
      expect.fail("expected forward returns");
      return;
    }
    expect(result.returns.days1).toBeCloseTo(0.02);
    expect(result.returns.days5).toBeCloseTo(0.12);
  });

  it("summarizes drift by item code", () => {
    const results = [
      {
        filing: {
          accessionNumber: "1",
          ticker: "A",
          filedAt: "",
          itemCodes: ["2.02"],
        },
        entryPrice: 100,
        returns: { days1: 0.01, days3: 0.02, days5: 0.03 },
      },
      {
        filing: {
          accessionNumber: "2",
          ticker: "B",
          filedAt: "",
          itemCodes: ["2.02"],
        },
        entryPrice: 100,
        returns: { days1: -0.01, days3: 0.0, days5: -0.02 },
      },
    ];
    const summary = summarizeByItemCode(results);
    expect(summary).toHaveLength(1);
    expect(summary[0]?.itemCode).toBe("2.02");
    expect(summary[0]?.sampleCount).toBe(2);
    expect(summary[0]?.avgReturn5d).toBeCloseTo(0.005);
  });

  it("computes Brier score buckets", () => {
    const buckets = computeConfidenceCalibration([
      { confidence: 0.85, hit5d: true },
      { confidence: 0.82, hit5d: false },
      { confidence: 0.45, hit5d: false },
    ]);
    expect(buckets.length).toBeGreaterThan(0);
    expect(buckets[0]?.brierScore).toBeGreaterThanOrEqual(0);
  });
});
