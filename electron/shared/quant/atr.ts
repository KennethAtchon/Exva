export type AtrBar = { high: number; low: number; close: number };

/** Wilder ATR over the most recent period of true ranges. */
export function computeAtr(bars: AtrBar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  const recent = bars.slice(-(period + 1));

  const trueRanges = recent.slice(1).map((bar, i) => {
    const prev = recent[i];
    if (!prev) return bar.high - bar.low;
    return Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - prev.close),
      Math.abs(bar.low - prev.close),
    );
  });

  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (const tr of trueRanges.slice(period)) {
    atr = (atr * (period - 1) + tr) / period;
  }

  return atr;
}
