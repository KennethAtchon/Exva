import { createHash } from "node:crypto";
import type { TradingTimeframe } from "@electron/shared/domain/enums";
import {
  purgedWalkForwardFolds,
  type PurgedFold,
} from "@electron/shared/quant/statistics";
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
  lifecycle?: PriceLifecyclePlan;
}

/** Absolute-price lifecycle for deterministic strategies with staged exits. */
export interface PriceLifecyclePlan {
  initialStopPrice: number;
  firstTarget: { price: number; closeFraction: number };
  sessionEndTs: string;
  sameBarPriority: "stop_before_target";
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

export interface FoldConfig {
  /** Bars dropped between train and test to avoid leakage. Default 1. */
  purge?: number;
}

export interface BacktestSpec {
  experienceId: string;
  strategy: DeterministicStrategy;
  symbols: string[];
  timeframe: TradingTimeframe;
  window: { start: string; end: string };
  folds: number;
  /** Purged walk-forward fold settings. */
  foldConfig?: FoldConfig;
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
  fills?: Array<{
    kind: "stop" | "tp1" | "runner_stop" | "session_close";
    price: number;
    fraction: number;
  }>;
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
  const purge = spec.foldConfig?.purge ?? 1;

  for (const symbol of spec.symbols) {
    const bars = (spec.barsBySymbol[symbol] ?? []).filter(
      (b) => b.ts >= spec.window.start && b.ts <= spec.window.end,
    );
    if (bars.length <= spec.strategy.warmupBars + 1) continue;

    const purgedFolds = purgedWalkForwardFolds(
      bars.length,
      Math.max(1, spec.folds),
      purge,
    );

    for (let i = spec.strategy.warmupBars; i < bars.length - 1; i++) {
      const fold = foldIndexForBar(i, purgedFolds);
      // Only score out-of-sample test segments (train + purge are excluded).
      if (fold == null) continue;

      const window = bars.slice(0, i + 1);
      const signal = spec.strategy.evaluate(window, {
        symbol,
        timeframe: spec.timeframe,
      });
      if (!signal) continue;

      const entry = bars[i];
      if (!entry) continue;
      const lifecycleExit = signal.lifecycle
        ? resolveLifecycleExit(bars, i, signal.action, signal.lifecycle)
        : null;
      const exitIdx =
        lifecycleExit?.exitIdx ??
        resolveExitIndex(bars, i, signal.action, spec.exitPolicy);
      const exit = bars[exitIdx];
      if (!exit) continue;
      const direction = signal.action === "buy" ? 1 : -1;
      const rawReturnBps = lifecycleExit
        ? lifecycleExit.fills.reduce(
            (total, fill) =>
              total +
              ((fill.price - entry.close) / entry.close) *
                10_000 *
                direction *
                fill.fraction,
            0,
          )
        : ((exit.close - entry.close) / entry.close) * 10_000 * direction;

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
        ...(lifecycleExit ? { fills: lifecycleExit.fills } : {}),
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
        foldConfig: { purge },
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

function resolveLifecycleExit(
  bars: OhlcvBar[],
  entryIdx: number,
  action: "buy" | "sell",
  lifecycle: PriceLifecyclePlan,
): {
  exitIdx: number;
  fills: Array<{
    kind: "stop" | "tp1" | "runner_stop" | "session_close";
    price: number;
    fraction: number;
  }>;
} {
  const isLong = action === "buy";
  const tpFraction = lifecycle.firstTarget.closeFraction;
  const runnerFraction = 1 - tpFraction;
  let runnerStop = lifecycle.initialStopPrice;
  let tp1Hit = false;
  const cutoffMs = new Date(lifecycle.sessionEndTs).getTime();

  for (let j = entryIdx + 1; j < bars.length; j++) {
    const bar = bars[j];
    if (!bar) continue;
    const hitsStop = isLong ? bar.low <= runnerStop : bar.high >= runnerStop;
    const hitsTarget =
      !tp1Hit &&
      (isLong
        ? bar.high >= lifecycle.firstTarget.price
        : bar.low <= lifecycle.firstTarget.price);
    if (hitsStop) {
      return {
        exitIdx: j,
        fills: tp1Hit
          ? [
              {
                kind: "tp1",
                price: lifecycle.firstTarget.price,
                fraction: tpFraction,
              },
              {
                kind: "runner_stop",
                price: runnerStop,
                fraction: runnerFraction,
              },
            ]
          : [{ kind: "stop", price: runnerStop, fraction: 1 }],
      };
    }
    if (hitsTarget) {
      tp1Hit = true;
      runnerStop = bars[entryIdx]?.close ?? runnerStop;
    }
    if (new Date(bar.ts).getTime() >= cutoffMs) {
      return {
        exitIdx: j,
        fills: tp1Hit
          ? [
              {
                kind: "tp1",
                price: lifecycle.firstTarget.price,
                fraction: tpFraction,
              },
              {
                kind: "session_close",
                price: bar.close,
                fraction: runnerFraction,
              },
            ]
          : [{ kind: "session_close", price: bar.close, fraction: 1 }],
      };
    }
  }
  const lastIdx = bars.length - 1;
  return {
    exitIdx: lastIdx,
    fills: [
      { kind: "session_close", price: bars[lastIdx]?.close ?? 0, fraction: 1 },
    ],
  };
}

/** Map a bar index to its purged walk-forward test fold, or null if in train/purge. */
export function foldIndexForBar(
  barIndex: number,
  folds: readonly PurgedFold[],
): number | null {
  for (const fold of folds) {
    if (barIndex >= fold.testStart && barIndex < fold.testEnd) {
      return fold.index;
    }
  }
  return null;
}

function resolveExitIndex(
  bars: OhlcvBar[],
  entryIdx: number,
  action: "buy" | "sell",
  policy: ExitPolicyConfig,
): number {
  const entry = bars[entryIdx];
  if (!entry) return entryIdx;
  const maxHold = policy.maxHoldBars ?? 20;
  const exitIdx = Math.min(bars.length - 1, entryIdx + maxHold);

  for (let j = entryIdx + 1; j <= exitIdx; j++) {
    const bar = bars[j];
    if (!bar) continue;
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

function summarizeFolds(
  trades: BacktestTrade[],
  foldCount: number,
): FoldMetrics[] {
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
