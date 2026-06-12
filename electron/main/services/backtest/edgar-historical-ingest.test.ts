import { describe, expect, it } from "vitest";
import { parseItemCodesFromHit } from "./edgar-historical-ingest";
import { joinFilingsWithOhlcv } from "./edgar-ohlcv-join";
import type { FilingRecord, OhlcvBar } from "./edgar-drift-backtest";

describe("edgar historical ingest", () => {
  it("parses SEC item codes from search hits", () => {
    expect(
      parseItemCodesFromHit({ items: ["1.01", "2.02", "invalid"] }),
    ).toEqual(["1.01", "2.02"]);
    expect(parseItemCodesFromHit({})).toEqual([]);
  });

  it("joins filings with OHLCV bars for forward returns", () => {
    const filing: FilingRecord = {
      accessionNumber: "0001",
      ticker: "NVDA",
      filedAt: "2024-01-02T16:00:00.000Z",
      itemCodes: ["2.02"],
    };
    const bars: OhlcvBar[] = [
      {
        date: "2024-01-02T21:00:00.000Z",
        open: 100,
        high: 101,
        low: 99,
        close: 100.5,
        volume: 1_000_000,
      },
      {
        date: "2024-01-03T21:00:00.000Z",
        open: 101,
        high: 105,
        low: 100,
        close: 104,
        volume: 1_100_000,
      },
      {
        date: "2024-01-04T21:00:00.000Z",
        open: 104,
        high: 106,
        low: 103,
        close: 105,
        volume: 900_000,
      },
    ];
    const results = joinFilingsWithOhlcv([filing], new Map([["NVDA", bars]]));
    expect(results).toHaveLength(1);
    expect(results[0]?.entryPrice).toBe(100);
    expect(results[0]?.returns.days1).toBeCloseTo((104 - 100) / 100, 5);
  });
});
