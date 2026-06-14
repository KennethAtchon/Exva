export type TradeSide = "BUY" | "SELL";

export type BrokerFeePreset = "alpaca_stock" | "mock" | "coinbase" | "default";

const COMMISSION_BPS: Record<BrokerFeePreset, number> = {
  alpaca_stock: 0,
  mock: 0,
  coinbase: 6,
  default: 5,
};

const BORROW_RATE_ANNUAL: Record<BrokerFeePreset, number> = {
  alpaca_stock: 0.03,
  mock: 0,
  coinbase: 0,
  default: 0.02,
};

export function spreadPctToBps(spreadPct: number): number {
  return spreadPct * 100;
}

export function estimateCommissionUsd(input: {
  brokerPreset?: BrokerFeePreset;
  sizeUsd: number;
}): number {
  const bps = COMMISSION_BPS[input.brokerPreset ?? "default"];
  return (input.sizeUsd * bps) / 10_000;
}

export function estimateBorrowUsd(input: {
  side: TradeSide;
  holdHours: number;
  sizeUsd: number;
  brokerPreset?: BrokerFeePreset;
}): number {
  if (input.side !== "SELL") return 0;
  const rate = BORROW_RATE_ANNUAL[input.brokerPreset ?? "default"];
  const holdYears = input.holdHours / (365 * 24);
  return input.sizeUsd * rate * holdYears;
}

export function computeExecutionCostUsd(input: {
  spreadAtEntryBps?: number | null;
  slippageBps?: number | null;
  commissionUsd?: number | null;
  borrowCostUsd?: number | null;
  sizeUsd: number;
}): number {
  const spreadCost =
    ((input.spreadAtEntryBps ?? 0) / 10_000) * input.sizeUsd * 0.5;
  const slippageCost = ((input.slippageBps ?? 0) / 10_000) * input.sizeUsd;
  return (
    spreadCost +
    slippageCost +
    (input.commissionUsd ?? 0) +
    (input.borrowCostUsd ?? 0)
  );
}

export function computeTimeToLevelMs(input: {
  openedAt: string;
  nowMs: number;
  currentPrice: number;
  targetPrice: number;
  side: TradeSide;
  /** When price first crossed target; null if not yet touched. */
  previouslyTouchedAt: string | null;
}): string | null {
  const crossed =
    input.side === "BUY"
      ? input.currentPrice >= input.targetPrice
      : input.currentPrice <= input.targetPrice;
  if (!crossed) return input.previouslyTouchedAt;
  if (input.previouslyTouchedAt) return input.previouslyTouchedAt;
  return new Date(input.nowMs).toISOString();
}

export function secondsBetween(isoA: string, isoB: string): number | null {
  const a = new Date(isoA).getTime();
  const b = new Date(isoB).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 1000));
}

export function computeMissedBetterExitUsd(input: {
  mfeUsd: number;
  finalPnlUsd: number;
}): number {
  return Math.max(0, input.mfeUsd - Math.max(0, input.finalPnlUsd));
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
