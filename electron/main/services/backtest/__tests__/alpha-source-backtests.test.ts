/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, expect, it } from "vitest";
import { backtestForm4Clusters } from "../form4-cluster-backtest";
import {
  backtestFundingDislocations,
  backtestUnusualVolume,
} from "../alpha-source-backtests";
import type { Form4Cluster } from "../../signals/form4/form4-parser";
import type { OhlcvBar } from "../../broker/adapters/broker-adapter";
import { questionSimilarity } from "../../../db/repositories/signals/cross-venue-market-links-repo";
import { fetchKrakenFundingRates } from "../../signals/strategy/funding-basis-scan";
import { computeUnusualVolumeSignal } from "../../signals/strategy/unusual-volume-signal";
import { marketSignalKindSchema } from "@electron/shared/domain/market-signal";

function makeBars(n: number, startClose = 100): OhlcvBar[] {
  const out: OhlcvBar[] = [];
  for (let i = 0; i < n; i++) {
    const close = startClose + i * 0.1;
    out.push({
      ts: `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      volume: i === n - 1 ? 5_000_000 : 1_000_000,
    });
  }
  // ensure unique increasing timestamps
  return out.map((b, i) => ({
    ...b,
    ts: new Date(Date.UTC(2025, 0, 1 + i)).toISOString(),
  }));
}

describe("alpha source backtests", () => {
  it("runs Form 4 cluster forward-return join", () => {
    const cluster: Form4Cluster = {
      ticker: "ACME",
      companyName: "Acme",
      insiderCount: 3,
      clusterValueUsd: 300_000,
      transactions: [],
      filedAt: new Date(Date.UTC(2025, 0, 5)).toISOString(),
      windowStart: new Date(Date.UTC(2025, 0, 1)).toISOString(),
      windowEnd: new Date(Date.UTC(2025, 0, 5)).toISOString(),
    };
    const result = backtestForm4Clusters({
      clusters: [cluster],
      barsBySymbol: { ACME: makeBars(40) },
      horizonBars: 5,
    });
    expect(result.tradeCount).toBe(1);
  });

  it("runs unusual-volume replay backtest", () => {
    const bars = makeBars(60).map((b, i, arr) =>
      i === arr.length - 1
        ? { ...b, volume: 8_000_000, high: b.close + 5, close: b.close + 4 }
        : b,
    );
    const result = backtestUnusualVolume({
      symbols: ["SPY"],
      barsBySymbol: { SPY: bars },
      window: {
        start: bars[0]!.ts,
        end: bars[bars.length - 1]!.ts,
      },
      folds: 2,
      rvolThreshold: 2,
    });
    expect(result.tradeCount).toBeGreaterThanOrEqual(0);
  });

  it("runs funding dislocation backtest", () => {
    const history = Array.from({ length: 40 }, (_, i) => ({
      venue: "kraken",
      symbol: "BTC/USD",
      ts: new Date(Date.UTC(2025, 0, 1 + i)).toISOString(),
      rate: 0.0001 * (i + 1),
    }));
    const result = backtestFundingDislocations({
      history,
      barsBySymbol: { "BTC/USD": makeBars(50) },
      extremePercentile: 0.9,
      windowSize: 30,
    });
    expect(result.tradeCount).toBeGreaterThanOrEqual(0);
  });

  it("exports helpers stay reachable", () => {
    expect(
      questionSimilarity("Fed cuts rates", "Will the Fed cut rates?"),
    ).toBeGreaterThan(0.3);
    expect(marketSignalKindSchema.parse("news")).toBe("news");
    expect(
      computeUnusualVolumeSignal({
        symbol: "SPY",
        ohlcv: makeBars(25).map((b) => ({
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
          ts: b.ts,
        })),
      }).action,
    ).toMatch(/buy|skip/);
    expect(typeof fetchKrakenFundingRates).toBe("function");
  });
});
