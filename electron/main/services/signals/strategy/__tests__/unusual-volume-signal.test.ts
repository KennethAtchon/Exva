/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, expect, it } from "vitest";
import {
  computeUnusualVolume,
  unusualVolumeHitToMarketSignal,
} from "../unusual-volume-signal";

function bars(n: number, opts?: { lastVol?: number; lastClose?: number }) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const isLast = i === n - 1;
    out.push({
      open: 100,
      high: 101 + (isLast ? 2 : 0),
      low: 99,
      close: isLast ? (opts?.lastClose ?? 104) : 100,
      volume: isLast ? (opts?.lastVol ?? 5_000_000) : 1_000_000,
      ts: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
    });
  }
  return out;
}

describe("unusual volume scanner", () => {
  it("emits when RVOL and price break clear thresholds", () => {
    const hit = computeUnusualVolume({
      symbol: "SPY",
      ohlcv: bars(25, { lastVol: 4_000_000, lastClose: 105 }),
      baselineBars: 20,
      rvolThreshold: 2.5,
      priceBreakPct: 0.005,
    });
    expect(hit).not.toBeNull();
    expect(hit!.rvol).toBeGreaterThanOrEqual(2.5);
    const signal = unusualVolumeHitToMarketSignal(hit!);
    expect(signal.kind).toBe("scan_hit");
    if (signal.kind !== "scan_hit") throw new Error("unreachable");
    expect(signal.payload.evidence.rvol).toBe(hit!.rvol);
    expect(signal.dedupeKey).toContain("unusual-volume");
  });

  it("skips when volume is ordinary", () => {
    const hit = computeUnusualVolume({
      symbol: "SPY",
      ohlcv: bars(25, { lastVol: 1_100_000, lastClose: 105 }),
      baselineBars: 20,
      rvolThreshold: 2.5,
      priceBreakPct: 0.005,
    });
    expect(hit).toBeNull();
  });
});
