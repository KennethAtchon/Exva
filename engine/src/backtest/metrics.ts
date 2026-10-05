import type { BacktestMetrics, BacktestSpec, Bar, EquityPoint, Trade } from "@shared/types.ts";
import { assetClassOf } from "@shared/types.ts";
import { round } from "../util.ts";

const DAY = 86_400_000;

export function computeMetrics(input: {
  spec: BacktestSpec;
  equity: EquityPoint[];
  trades: Trade[];
  exposureSteps: number;
  totalSteps: number;
  bars: Map<string, Bar[]>;
  aiCalls: number;
  aiCostUsd: number;
}): BacktestMetrics {
  const { spec, equity, trades } = input;
  const days = Math.max((spec.to - spec.from) / DAY, 1 / 24);
  const ending = equity[equity.length - 1]?.equity ?? spec.startingCash;
  const closed = trades.filter((t) => t.status === "closed" && t.pnlUsd !== null);
  const wins = closed.filter((t) => (t.pnlUsd ?? 0) > 0).map((t) => t.pnlUsd as number);
  const losses = closed.filter((t) => (t.pnlUsd ?? 0) <= 0).map((t) => t.pnlUsd as number);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  let peak = spec.startingCash;
  let maxDd = 0;
  let maxDdPct = 0;
  for (const p of equity) {
    peak = Math.max(peak, p.equity);
    const dd = peak - p.equity;
    if (dd > maxDd) maxDd = dd;
    if (peak > 0 && dd / peak > maxDdPct) maxDdPct = dd / peak;
  }

  const lossSum = Math.abs(sum(losses));
  return {
    days: round(days, 2),
    startingCash: spec.startingCash,
    endingEquity: round(ending),
    netPnl: round(ending - spec.startingCash),
    netPnlPct: round(((ending - spec.startingCash) / spec.startingCash) * 100, 3),
    trades: closed.length,
    tradesPerDay: round(closed.length / days, 2),
    winRate: closed.length ? round((wins.length / closed.length) * 100, 1) : null,
    avgWin: wins.length ? round(sum(wins) / wins.length) : null,
    avgLoss: losses.length ? round(sum(losses) / losses.length) : null,
    profitFactor: lossSum > 0 ? round(sum(wins) / lossSum, 2) : wins.length ? null : null,
    maxDrawdown: round(maxDd),
    maxDrawdownPct: round(maxDdPct * 100, 2),
    sharpe: sharpe(equity, spec.symbols.some((s) => assetClassOf(s) === "stock") ? 252 : 365),
    exposurePct: input.totalSteps ? round((input.exposureSteps / input.totalSteps) * 100, 1) : 0,
    buyHoldPct: buyAndHold(input.bars, spec.from, spec.to),
    openAtEnd: trades.filter((t) => t.status === "open").length,
    aiCalls: input.aiCalls,
    aiCostUsd: round(input.aiCostUsd, 4),
  };
}

/** Annualized Sharpe from end-of-day equity. Null with fewer than 5 days or no variation. */
function sharpe(equity: EquityPoint[], periodsPerYear: number): number | null {
  const byDay = new Map<number, number>();
  for (const p of equity) byDay.set(Math.floor(p.ts / DAY), p.equity);
  const closes = [...byDay.values()];
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++)
    rets.push((closes[i] as number) / (closes[i - 1] as number) - 1);
  if (rets.length < 5) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1));
  return sd > 0 ? round((mean / sd) * Math.sqrt(periodsPerYear), 2) : null;
}

function buyAndHold(bars: Map<string, Bar[]>, from: number, to: number): number | null {
  const changes: number[] = [];
  for (const list of bars.values()) {
    const inRange = list.filter((b) => b.ts >= from && b.ts < to);
    const first = inRange[0];
    const last = inRange[inRange.length - 1];
    if (first && last) changes.push((last.c / first.o - 1) * 100);
  }
  return changes.length ? round(changes.reduce((a, b) => a + b, 0) / changes.length, 3) : null;
}

/** Keep at most `max` points, always including the first and last. */
export function downsample<T>(points: T[], max: number): T[] {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)] as T);
}
