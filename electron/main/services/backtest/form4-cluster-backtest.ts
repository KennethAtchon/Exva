/**
 * Form 4 cluster backtest: join insider-buy clusters to OHLCV forward returns.
 * Generalizes edgar-ohlcv-join from 8-K drift to Form 4 clusters.
 */

import type { OhlcvBar } from "../broker/adapters/broker-adapter";
import type { Form4Cluster } from "../signals/form4/form4-parser";

export interface Form4ClusterBacktestTrade {
  ticker: string;
  filedAt: string;
  entryTs: string;
  exitTs: string;
  entryPrice: number;
  exitPrice: number;
  returnBps: number;
  clusterValueUsd: number;
  insiderCount: number;
}

export interface Form4ClusterBacktestResult {
  trades: Form4ClusterBacktestTrade[];
  expectancyBps: number;
  tradeCount: number;
  winRate: number;
}

/**
 * For each cluster, enter at next bar open after filedAt and exit after
 * `horizonBars` (default 5 trading days).
 */
export function backtestForm4Clusters(input: {
  clusters: Form4Cluster[];
  barsBySymbol: Record<string, OhlcvBar[]>;
  horizonBars?: number;
}): Form4ClusterBacktestResult {
  const horizon = input.horizonBars ?? 5;
  const trades: Form4ClusterBacktestTrade[] = [];

  for (const cluster of input.clusters) {
    const bars = (input.barsBySymbol[cluster.ticker] ?? [])
      .slice()
      .sort((a, b) => a.ts.localeCompare(b.ts));
    if (bars.length === 0) continue;
    const filedMs = Date.parse(cluster.filedAt);
    const entryIdx = bars.findIndex((b) => Date.parse(b.ts) > filedMs);
    if (entryIdx < 0) continue;
    const exitIdx = entryIdx + horizon;
    if (exitIdx >= bars.length) continue;
    const entry = bars[entryIdx];
    const exit = bars[exitIdx];
    if (!entry || !exit || entry.open <= 0) continue;
    const returnBps = ((exit.close - entry.open) / entry.open) * 10_000;
    trades.push({
      ticker: cluster.ticker,
      filedAt: cluster.filedAt,
      entryTs: entry.ts,
      exitTs: exit.ts,
      entryPrice: entry.open,
      exitPrice: exit.close,
      returnBps,
      clusterValueUsd: cluster.clusterValueUsd,
      insiderCount: cluster.insiderCount,
    });
  }

  const tradeCount = trades.length;
  const expectancyBps =
    tradeCount === 0
      ? 0
      : trades.reduce((s, t) => s + t.returnBps, 0) / tradeCount;
  const wins = trades.filter((t) => t.returnBps > 0).length;
  return {
    trades,
    expectancyBps,
    tradeCount,
    winRate: tradeCount === 0 ? 0 : wins / tradeCount,
  };
}
