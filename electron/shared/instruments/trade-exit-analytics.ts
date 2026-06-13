export type TradeSide = "BUY" | "SELL";

export function spreadPctToBps(spreadPct: number): number {
  return spreadPct * 100;
}

export function computeSlippageBps(input: {
  side: TradeSide;
  referencePrice: number;
  filledPrice: number;
}): number | null {
  const { referencePrice, filledPrice } = input;
  if (referencePrice <= 0 || filledPrice <= 0) return null;
  const rawPct = ((filledPrice - referencePrice) / referencePrice) * 100;
  const signedPct = input.side === "BUY" ? rawPct : -rawPct;
  return signedPct * 100;
}

export function computeMfeMaeUsd(input: {
  side: TradeSide;
  entryPrice: number;
  positionSizeUsd: number;
  highWaterMarkPrice: number | null;
  lowWaterMarkPrice: number | null;
  exitPrice: number;
}): { mfeUsd: number; maeUsd: number } {
  const entry = input.entryPrice;
  const size = input.positionSizeUsd;
  if (entry <= 0 || size <= 0) {
    return { mfeUsd: 0, maeUsd: 0 };
  }

  const high = input.highWaterMarkPrice ?? entry;
  const low = input.lowWaterMarkPrice ?? entry;
  const exit = input.exitPrice;

  if (input.side === "BUY") {
    const mfePct = Math.max(0, (high - entry) / entry);
    const maePct = Math.max(0, (entry - low) / entry);
    const exitPct = (exit - entry) / entry;
    const mfeUsd = mfePct * size;
    const maeUsd = maePct * size;
    return {
      mfeUsd: Math.max(mfeUsd, exitPct > 0 ? exitPct * size : 0),
      maeUsd: Math.max(maeUsd, exitPct < 0 ? Math.abs(exitPct) * size : 0),
    };
  }

  const mfePct = Math.max(0, (entry - low) / entry);
  const maePct = Math.max(0, (high - entry) / entry);
  const exitPct = (entry - exit) / entry;
  return {
    mfeUsd: Math.max(mfePct * size, exitPct > 0 ? exitPct * size : 0),
    maeUsd: Math.max(maePct * size, exitPct < 0 ? Math.abs(exitPct) * size : 0),
  };
}
