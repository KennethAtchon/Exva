/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, expect, it } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import { BacktestRunsRepo } from "../../../db/repositories/research/experiment-repos";
import { backtestForm4Clusters } from "../form4-cluster-backtest";
import {
  backtestUnusualVolume,
  backtestFundingDislocations,
} from "../alpha-source-backtests";
import type { Form4Cluster } from "../../signals/form4/form4-parser";
import type { OhlcvBar } from "../../broker/adapters/broker-adapter";

function makeBars(n: number): OhlcvBar[] {
  return Array.from({ length: n }, (_, i) => ({
    ts: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
    open: 100 + i * 0.05,
    high: 101 + i * 0.05,
    low: 99 + i * 0.05,
    close: 100.2 + i * 0.05,
    volume: i === n - 1 ? 6_000_000 : 1_000_000,
  }));
}

describe("alpha source backtest_runs persistence", () => {
  it("records Form 4 / unusual-volume / funding runs", () => {
    const db = createTestDb();
    const repo = new BacktestRunsRepo(db);
    const bars = makeBars(80);
    const now = new Date().toISOString();

    const form4: Form4Cluster = {
      ticker: "ACME",
      companyName: "Acme",
      insiderCount: 3,
      clusterValueUsd: 250_000,
      transactions: [],
      filedAt: bars[10]!.ts,
      windowStart: bars[5]!.ts,
      windowEnd: bars[10]!.ts,
    };
    const form4Result = backtestForm4Clusters({
      clusters: [form4],
      barsBySymbol: { ACME: bars },
    });
    repo.insert({
      id: crypto.randomUUID(),
      experienceId: "form4-insider-cluster",
      modelVersionId: null,
      contractHash: "form4-v1",
      windowStart: bars[0]!.ts,
      windowEnd: bars[bars.length - 1]!.ts,
      foldConfigJson: JSON.stringify({ folds: 1 }),
      costModelJson: JSON.stringify({
        spreadBps: 5,
        feeBps: 0,
        slippageBps: 5,
      }),
      metricsJson: JSON.stringify(form4Result),
      verdict: form4Result.expectancyBps >= 0 ? "pass" : "fail",
      createdAt: now,
    });
    expect(
      repo.latestForExperience("form4-insider-cluster")?.experienceId,
    ).toBe("form4-insider-cluster");

    const volBars = bars.map((b, i, arr) =>
      i === arr.length - 1
        ? { ...b, volume: 8_000_000, high: b.close + 3, close: b.close + 2 }
        : b,
    );
    const volResult = backtestUnusualVolume({
      symbols: ["SPY"],
      barsBySymbol: { SPY: volBars },
      window: { start: volBars[0]!.ts, end: volBars[volBars.length - 1]!.ts },
      folds: 2,
      rvolThreshold: 2,
    });
    repo.insert({
      id: crypto.randomUUID(),
      experienceId: "unusual-volume",
      modelVersionId: null,
      contractHash: "rvol-v1",
      windowStart: volBars[0]!.ts,
      windowEnd: volBars[volBars.length - 1]!.ts,
      foldConfigJson: JSON.stringify({ folds: 2 }),
      costModelJson: JSON.stringify({
        spreadBps: 2,
        feeBps: 0,
        slippageBps: 3,
      }),
      metricsJson: JSON.stringify(volResult),
      verdict: "inconclusive",
      createdAt: now,
    });
    expect(repo.latestForExperience("unusual-volume")?.experienceId).toBe(
      "unusual-volume",
    );

    const fundingHistory = Array.from({ length: 40 }, (_, i) => ({
      venue: "kraken",
      symbol: "BTC/USD",
      ts: bars[i]!.ts,
      rate: 0.0001 * (i + 1),
    }));
    const fundingResult = backtestFundingDislocations({
      history: fundingHistory,
      barsBySymbol: { "BTC/USD": bars },
      extremePercentile: 0.9,
      windowSize: 20,
    });
    repo.insert({
      id: crypto.randomUUID(),
      experienceId: "funding-basis",
      modelVersionId: null,
      contractHash: "funding-v1",
      windowStart: bars[0]!.ts,
      windowEnd: bars[39]!.ts,
      foldConfigJson: JSON.stringify({ folds: 1 }),
      costModelJson: JSON.stringify({
        spreadBps: 5,
        feeBps: 0,
        slippageBps: 5,
      }),
      metricsJson: JSON.stringify(fundingResult),
      verdict: "inconclusive",
      createdAt: now,
    });
    expect(repo.latestForExperience("funding-basis")?.experienceId).toBe(
      "funding-basis",
    );
    db.sqlite.close();
  });
});
