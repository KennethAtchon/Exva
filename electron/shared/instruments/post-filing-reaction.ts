export type OhlcvBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type TradeDirection = "long" | "short";

export type PostFilingReaction = {
  gapPct: number | null;
  reaction30mPct: number | null;
  reaction60mPct: number | null;
  volumeZScore: number | null;
};

function barMs(bar: OhlcvBar): number {
  return new Date(bar.date).getTime();
}

function findBarAtOrAfter(bars: OhlcvBar[], targetMs: number): number {
  return bars.findIndex((bar) => barMs(bar) >= targetMs);
}

/** Compute deterministic post-filing reaction features from intraday or daily bars. */
export function computePostFilingReaction(input: {
  filedAt: string;
  bars: OhlcvBar[];
  /** When bars are daily, use open of entry day vs prior close for gap. */
  latencyMinutes?: number;
}): PostFilingReaction {
  const { bars, filedAt, latencyMinutes = 10 } = input;
  if (bars.length < 2) {
    return {
      gapPct: null,
      reaction30mPct: null,
      reaction60mPct: null,
      volumeZScore: null,
    };
  }

  const filedMs = new Date(filedAt).getTime();
  const entryIdx = findBarAtOrAfter(bars, filedMs + latencyMinutes * 60 * 1000);
  if (entryIdx < 0) {
    return {
      gapPct: null,
      reaction30mPct: null,
      reaction60mPct: null,
      volumeZScore: null,
    };
  }

  const entryBar = bars[entryIdx];
  const priorBar = bars[entryIdx - 1];
  const entryPrice = entryBar?.open ?? entryBar?.close ?? 0;
  const priorClose = priorBar?.close ?? entryPrice;

  const gapPct = priorClose > 0 ? (entryPrice - priorClose) / priorClose : null;

  const reactionAt = (minutes: number): number | null => {
    const idx = findBarAtOrAfter(
      bars,
      filedMs + latencyMinutes * 60 * 1000 + minutes * 60 * 1000,
    );
    if (idx < 0 || !entryPrice) return null;
    const close = bars[idx]?.close;
    if (!close) return null;
    return (close - entryPrice) / entryPrice;
  };

  const baselineVolumes = bars
    .slice(Math.max(0, entryIdx - 20), entryIdx)
    .map((b) => b.volume)
    .filter((v) => v > 0);
  const avgVol =
    baselineVolumes.reduce((s, v) => s + v, 0) /
    Math.max(baselineVolumes.length, 1);
  const stdVol = Math.sqrt(
    baselineVolumes.reduce((s, v) => s + (v - avgVol) ** 2, 0) /
      Math.max(baselineVolumes.length, 1),
  );
  const entryVol = entryBar?.volume ?? 0;
  const volumeZScore =
    stdVol > 0 ? (entryVol - avgVol) / stdVol : entryVol > avgVol ? 1 : 0;

  return {
    gapPct,
    reaction30mPct: reactionAt(30),
    reaction60mPct: reactionAt(60),
    volumeZScore,
  };
}
