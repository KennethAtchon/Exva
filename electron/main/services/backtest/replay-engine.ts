import { createHash } from "node:crypto";
import type { TradingTimeframe } from "@electron/shared/domain/enums";
import type { OhlcvBar } from "../broker/adapters/broker-adapter";

/**
 * General bar-replay engine. Deterministic strategies share the same evaluate()
 * with live ScheduledScans. LLM strategies use frozen-decision replay separately.
 */

export interface DeterministicStrategySignal {
  action: "buy" | "sell";
  strength: number;
  evidence: Record<string, number>;
  barWindowHash: string;
}

export interface DeterministicStrategy {
  id: string;
  warmupBars: number;
  evaluate(
    bars: OhlcvBar[],
    ctx: { symbol: string; timeframe: TradingTimeframe },
  ): DeterministicStrategySignal | null;
}

export interface ExitPolicyConfig {
  stopLossPct?: number;
  takeProfitPct?: number;
  maxHoldBars?: number;
}

export interface BacktestCosts {
  spreadBps: number;
  feeBps: number;
  slippageBps: number;
}

export interface BacktestSpec {
  experienceId: string;
  strategy: DeterministicStrategy;
  symbols: string[];
  timeframe: TradingTimeframe;
  window: { start: string; end: string };
  folds: number;
  costs: BacktestCosts;
  exitPolicy: ExitPolicyConfig;
  /** Bars keyed by symbol (pre-loaded from MarketDataService). */
  barsBySymbol: Record<string, OhlcvBar[]>;
}

export interface BacktestTrade {
  symbol: string;
  side: "buy" | "sell";
  entryTs: string;
  exitTs: string;
  entryPrice: number;
  exitPrice: number;
  returnBps: number;
  netReturnBps: number;
  fold: number;
  evidence: Record<string, number>;
}

export interface FoldMetrics {
  fold: number;
  tradeCount: number;
  expectancyBps: number;
  sharpe: number;
  maxDrawdownPct: number;
  winRate: number;
}

export interface BacktestResult {
  runHash: string;
  experienceId: string;
  strategyId: string;
  trades: BacktestTrade[];
  folds: FoldMetrics[];
  tradeCount: number;
  expectancyBps: number;
  sharpe: number;
  maxDrawdownPct: number;
  costDragBps: number;
}

export function hashBarWindow(bars: OhlcvBar[]): string {
  const payload = bars.map((b) => `${b.ts}:${b.close}`).join("|");
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export function runBacktest(spec: BacktestSpec): BacktestResult {
  const allTrades: BacktestTrade[] = [];
  const costBps =
    spec.costs.spreadBps + spec.costs.feeBps + spec.costs.slippageBps;

  for (const symbol of spec.symbols) {
    const bars = (spec.barsBySymbol[symbol] ?? []).filter(
      (b) => b.ts >= spec.window.start && b.ts <= spec.window.end,
    );
    if (bars.length <= spec.strategy.warmupBars + 1) continue;

    const foldSize = Math.max(
      1,
      Math.floor(bars.length / Math.max(1, spec.folds)),
    );

    for (let i = spec.strategy.warmupBars; i < bars.length - 1; i++) {
      const window = bars.slice(0, i + 1);
      const signal = spec.strategy.evaluate(window, {
        symbol,
        timeframe: spec.timeframe,
      });
      if (!signal) continue;

      const entry = bars[i]!;
      const exitIdx = resolveExitIndex(bars, i, signal.action, spec.exitPolicy);
      const exit = bars[exitIdx]!;
      const direction = signal.action === "buy" ? 1 : -1;
      const rawReturnBps =
        ((exit.close - entry.close) / entry.close) * 10_000 * direction;
      const fold = Math.min(
        spec.folds - 1,
        Math.floor(i / foldSize),
      );

      allTrades.push({
        symbol,
        side: signal.action,
        entryTs: entry.ts,
        exitTs: exit.ts,
        entryPrice: entry.close,
        exitPrice: exit.close,
        returnBps: rawReturnBps,
        netReturnBps: rawReturnBps - costBps,
        fold,
        evidence: signal.evidence,
      });
      i = exitIdx; // skip overlapping hold
    }
  }

  const folds = summarizeFolds(allTrades, spec.folds);
  const expectancyBps =
    allTrades.length === 0
      ? 0
      : allTrades.reduce((s, t) => s + t.netReturnBps, 0) / allTrades.length;
  const sharpe = computeSharpe(allTrades.map((t) => t.netReturnBps));
  const maxDrawdownPct = computeMaxDrawdownPct(allTrades);
  const runHash = createHash("sha256")
    .update(
      JSON.stringify({
        experienceId: spec.experienceId,
        strategyId: spec.strategy.id,
        window: spec.window,
        folds: spec.folds,
        costs: spec.costs,
        exitPolicy: spec.exitPolicy,
        symbols: spec.symbols,
        tradeCount: allTrades.length,
        expectancyBps,
      }),
    )
    .digest("hex")
    .slice(0, 24);

  return {
    runHash,
    experienceId: spec.experienceId,
    strategyId: spec.strategy.id,
    trades: allTrades,
    folds,
    tradeCount: allTrades.length,
    expectancyBps,
    sharpe,
    maxDrawdownPct,
    costDragBps: costBps,
  };
}

function resolveExitIndex(
  bars: OhlcvBar[],
  entryIdx: number,
  action: "buy" | "sell",
  policy: ExitPolicyConfig,
): number {
  const entry = bars[entryIdx]!;
  const maxHold = policy.maxHoldBars ?? 20;
  let exitIdx = Math.min(bars.length - 1, entryIdx + maxHold);

  for (let j = entryIdx + 1; j <= exitIdx; j++) {
    const bar = bars[j]!;
    const movePct =
      action === "buy"
        ? (bar.close - entry.close) / entry.close
        : (entry.close - bar.close) / entry.close;
    if (policy.takeProfitPct != null && movePct >= policy.takeProfitPct) {
      return j;
    }
    if (policy.stopLossPct != null && movePct <= -policy.stopLossPct) {
      return j;
    }
  }
  return exitIdx;
}

function summarizeFolds(trades: BacktestTrade[], foldCount: number): FoldMetrics[] {
  const folds: FoldMetrics[] = [];
  for (let f = 0; f < foldCount; f++) {
    const subset = trades.filter((t) => t.fold === f);
    const expectancyBps =
      subset.length === 0
        ? 0
        : subset.reduce((s, t) => s + t.netReturnBps, 0) / subset.length;
    const wins = subset.filter((t) => t.netReturnBps > 0).length;
    folds.push({
      fold: f,
      tradeCount: subset.length,
      expectancyBps,
      sharpe: computeSharpe(subset.map((t) => t.netReturnBps)),
      maxDrawdownPct: computeMaxDrawdownPct(subset),
      winRate: subset.length === 0 ? 0 : wins / subset.length,
    });
  }
  return folds;
}

function computeSharpe(returns: number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return mean / std;
}

function computeMaxDrawdownPct(trades: BacktestTrade[]): number {
  let peak = 0;
  let equity = 0;
  let maxDd = 0;
  for (const t of trades) {
    equity += t.netReturnBps / 10_000;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd * 100;
}
