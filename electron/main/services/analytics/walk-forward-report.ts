import type { Trade } from "@/lib/types";

export type WalkForwardSlice = {
  label: "in_sample" | "out_of_sample";
  tradeCount: number;
  winRate: number;
  expectancy: number;
  netPnlUsd: number;
};

export type WalkForwardReport = {
  splitIndex: number;
  splitRatio: number;
  inSample: WalkForwardSlice;
  outOfSample: WalkForwardSlice;
};

export function computeWalkForwardReport(
  trades: Trade[],
  splitRatio = 0.7,
): WalkForwardReport | null {
  const ordered = [...trades]
    .filter((trade) => trade.closed_at)
    .sort(
      (a, b) =>
        new Date(a.closed_at ?? 0).getTime() -
        new Date(b.closed_at ?? 0).getTime(),
    );
  if (ordered.length < 10) return null;

  const splitIndex = Math.max(1, Math.floor(ordered.length * splitRatio));
  const inSampleTrades = ordered.slice(0, splitIndex);
  const outOfSampleTrades = ordered.slice(splitIndex);
  if (outOfSampleTrades.length === 0) return null;

  return {
    splitIndex,
    splitRatio,
    inSample: summarizeSlice("in_sample", inSampleTrades),
    outOfSample: summarizeSlice("out_of_sample", outOfSampleTrades),
  };
}

function summarizeSlice(
  label: WalkForwardSlice["label"],
  trades: Trade[],
): WalkForwardSlice {
  const wins = trades.filter((trade) => (trade.final_pnl_usd ?? 0) > 0);
  const losses = trades.filter((trade) => (trade.final_pnl_usd ?? 0) <= 0);
  const tradeCount = trades.length;
  const winRate = tradeCount > 0 ? wins.length / tradeCount : 0;
  const grossWins = wins.reduce(
    (sum, trade) => sum + (trade.final_pnl_usd ?? 0),
    0,
  );
  const grossLosses = Math.abs(
    losses.reduce((sum, trade) => sum + (trade.final_pnl_usd ?? 0), 0),
  );
  const avgWinUsd = wins.length > 0 ? grossWins / wins.length : 0;
  const avgLossUsd = losses.length > 0 ? grossLosses / losses.length : 0;
  const lossRate = 1 - winRate;
  return {
    label,
    tradeCount,
    winRate,
    expectancy: winRate * avgWinUsd - lossRate * avgLossUsd,
    netPnlUsd: trades.reduce(
      (sum, trade) => sum + (trade.final_pnl_usd ?? 0),
      0,
    ),
  };
}
