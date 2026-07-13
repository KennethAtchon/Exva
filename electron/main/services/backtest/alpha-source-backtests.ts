/**
 * Unusual-volume + funding-rate backtest helpers that record into the same
 * shape consumers expect from replay-engine / backtest_runs.
 */

import type { OhlcvBar } from "../broker/adapters/broker-adapter";
import { createUnusualVolumeStrategy } from "../signals/strategy/unusual-volume-signal";
import { runBacktest, type BacktestResult } from "./replay-engine";
import {
  detectFundingDislocations,
  type FundingObservation,
} from "../signals/strategy/funding-basis-scan";

export function backtestUnusualVolume(input: {
  symbols: string[];
  barsBySymbol: Record<string, OhlcvBar[]>;
  window: { start: string; end: string };
  folds?: number;
  rvolThreshold?: number;
}): BacktestResult {
  return runBacktest({
    experienceId: "unusual-volume",
    strategy: createUnusualVolumeStrategy({
      rvolThreshold: input.rvolThreshold ?? 2.5,
    }),
    symbols: input.symbols,
    barsBySymbol: input.barsBySymbol,
    timeframe: "1d",
    window: input.window,
    folds: input.folds ?? 3,
    costs: { spreadBps: 2, feeBps: 0, slippageBps: 3 },
    exitPolicy: { maxHoldBars: 5, takeProfitPct: 3, stopLossPct: 2 },
  });
}

export interface FundingBacktestTrade {
  symbol: string;
  ts: string;
  rate: number;
  percentile: number;
  /** Forward spot return over horizon (bps), if bars provided. */
  forwardReturnBps: number | null;
}

/**
 * Walk funding history; when extreme percentile fires, optionally measure
 * subsequent spot mean-reversion over `horizonBars`.
 */
export function backtestFundingDislocations(input: {
  history: FundingObservation[];
  barsBySymbol?: Record<string, OhlcvBar[]>;
  horizonBars?: number;
  extremePercentile?: number;
  windowSize?: number;
}): {
  trades: FundingBacktestTrade[];
  expectancyBps: number;
  tradeCount: number;
} {
  const horizon = input.horizonBars ?? 8;
  const trades: FundingBacktestTrade[] = [];
  const byKey = new Map<string, FundingObservation[]>();
  for (const obs of [...input.history].sort((a, b) =>
    a.ts.localeCompare(b.ts),
  )) {
    const key = `${obs.venue}|${obs.symbol}`;
    const list = byKey.get(key) ?? [];
    list.push(obs);
    byKey.set(key, list);
    const hit = detectFundingDislocations(list.slice(0, -1), obs, {
      windowSize: input.windowSize ?? 90,
      extremePercentile: input.extremePercentile ?? 0.95,
    });
    if (!hit) continue;
    let forwardReturnBps: number | null = null;
    const bars = input.barsBySymbol?.[obs.symbol];
    if (bars) {
      const sorted = [...bars].sort((a, b) => a.ts.localeCompare(b.ts));
      const idx = sorted.findIndex((b) => b.ts >= obs.ts);
      const exit = idx >= 0 ? sorted[idx + horizon] : undefined;
      const entry = idx >= 0 ? sorted[idx] : undefined;
      if (entry && exit && entry.close > 0) {
        // Extreme positive funding → crowded long → expect mean-reversion down.
        const raw = ((exit.close - entry.close) / entry.close) * 10_000;
        forwardReturnBps = hit.rate > 0 ? -raw : raw;
      }
    }
    trades.push({
      symbol: obs.symbol,
      ts: obs.ts,
      rate: hit.rate,
      percentile: hit.percentile,
      forwardReturnBps,
    });
  }
  const measured = trades.filter((t) => t.forwardReturnBps != null);
  const expectancyBps =
    measured.length === 0
      ? 0
      : measured.reduce((s, t) => s + (t.forwardReturnBps ?? 0), 0) /
        measured.length;
  return { trades, expectancyBps, tradeCount: trades.length };
}
