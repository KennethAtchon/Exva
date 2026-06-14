/**
 * Offline EDGAR 8-K drift backtest harness (audit §2.3, §7-#1, TODO §4).
 * Joins item-code-tagged filings with forward returns — no live machinery.
 */

import {
  classifyFilingPolarity,
  polarityToDirection,
  type FilingPolarity,
  type TradeDirection,
} from "@electron/shared/instruments/filing-polarity";
import {
  checkEdgarTradability,
  DEFAULT_EDGAR_TRADABILITY,
  type EdgarTradabilityFilters,
} from "@electron/shared/instruments/edgar-tradability";
import {
  computePostFilingReaction,
  type OhlcvBar,
  type PostFilingReaction,
} from "@electron/shared/instruments/post-filing-reaction";

export type { OhlcvBar, FilingPolarity, TradeDirection, PostFilingReaction };

export type FilingRecord = {
  accessionNumber: string;
  ticker: string;
  filedAt: string;
  itemCodes: string[];
  marketCapBucket?: "mega" | "large" | "mid" | "small";
  headline?: string;
  polarity?: FilingPolarity;
  direction?: TradeDirection;
  /** For tradability pre-filters */
  entryPriceUsd?: number;
  entryVolumeShares?: number;
  spreadPct?: number;
};

export type ForwardReturnResult = {
  filing: FilingRecord;
  entryPrice: number;
  returns: { days1: number; days3: number; days5: number };
  reaction: PostFilingReaction;
  signedReturns: { days1: number; days3: number; days5: number };
};

export type ItemCodeDriftSummary = {
  itemCode: string;
  direction: TradeDirection;
  sampleCount: number;
  avgReturn1d: number;
  avgReturn3d: number;
  avgReturn5d: number;
  hitRate5d: number;
};

export type ItemCodeDirectionSummary = ItemCodeDriftSummary & {
  polarity: FilingPolarity;
};

export type ConfidenceCalibrationBucket = {
  bucket: string;
  count: number;
  avgConfidence: number;
  hitRate: number;
  brierScore: number;
};

function enrichFiling(filing: FilingRecord): FilingRecord {
  const polarity =
    filing.polarity ??
    classifyFilingPolarity({
      itemCodes: filing.itemCodes,
      headline: filing.headline,
    });
  const direction = filing.direction ?? polarityToDirection(polarity) ?? "long";
  return { ...filing, polarity, direction };
}

/** Entry at next bar open after filing + latencyMinutes (default ~10 min post-filing). */
export function entryBarIndex(
  filingDate: string,
  bars: OhlcvBar[],
  latencyMinutes = 10,
): number {
  const entryMs = new Date(filingDate).getTime() + latencyMinutes * 60 * 1000;
  return bars.findIndex((bar) => new Date(bar.date).getTime() >= entryMs);
}

function signedReturnPct(raw: number, direction: TradeDirection): number {
  return direction === "short" ? -raw : raw;
}

export function computeForwardReturns(
  filing: FilingRecord,
  bars: OhlcvBar[],
  latencyMinutes = 10,
): ForwardReturnResult | null {
  const enriched = enrichFiling(filing);
  const entryIdx = entryBarIndex(enriched.filedAt, bars, latencyMinutes);
  if (entryIdx < 0 || entryIdx >= bars.length) return null;
  const entryPrice = bars[entryIdx]?.open ?? bars[entryIdx]?.close;
  if (!entryPrice || entryPrice <= 0) return null;

  const ret = (offset: number) => {
    const bar = bars[entryIdx + offset];
    if (!bar) return 0;
    return (bar.close - entryPrice) / entryPrice;
  };

  const raw = { days1: ret(1), days3: ret(3), days5: ret(5) };
  const direction = enriched.direction ?? "long";

  return {
    filing: enriched,
    entryPrice,
    returns: raw,
    signedReturns: {
      days1: signedReturnPct(raw.days1, direction),
      days3: signedReturnPct(raw.days3, direction),
      days5: signedReturnPct(raw.days5, direction),
    },
    reaction: computePostFilingReaction({
      filedAt: enriched.filedAt,
      bars,
      latencyMinutes,
    }),
  };
}

export function applyEdgarPrefilters(
  filings: FilingRecord[],
  filters: EdgarTradabilityFilters = DEFAULT_EDGAR_TRADABILITY,
): {
  passed: FilingRecord[];
  rejected: Array<{ filing: FilingRecord; reason: string }>;
} {
  const passed: FilingRecord[] = [];
  const rejected: Array<{ filing: FilingRecord; reason: string }> = [];

  for (const filing of filings) {
    const price = filing.entryPriceUsd ?? 10;
    const volume = filing.entryVolumeShares ?? 100_000;
    const spread = filing.spreadPct ?? 0.1;
    const check = checkEdgarTradability(
      {
        priceUsd: price,
        volumeShares: volume,
        spreadPct: spread,
        marketCapBucket: filing.marketCapBucket,
      },
      filters,
    );
    if (check.ok) passed.push(filing);
    else rejected.push({ filing, reason: check.reason });
  }
  return { passed, rejected };
}

function rowSignedReturn(
  row: ForwardReturnResult,
  horizon: "days1" | "days3" | "days5",
): number {
  if (row.signedReturns) return row.signedReturns[horizon];
  const dir = row.filing.direction ?? "long";
  const raw = row.returns[horizon];
  return dir === "short" ? -raw : raw;
}

export function summarizeByItemCode(
  results: ForwardReturnResult[],
): ItemCodeDriftSummary[] {
  const byKey = new Map<string, ForwardReturnResult[]>();
  for (const row of results) {
    const direction = row.filing.direction ?? "long";
    for (const code of row.filing.itemCodes) {
      const key = `${code}|${direction}`;
      const list = byKey.get(key) ?? [];
      list.push(row);
      byKey.set(key, list);
    }
  }

  return [...byKey.entries()].map(([key, rows]) => {
    const [itemCode, direction] = key.split("|") as [string, TradeDirection];
    const n = rows.length;
    const avgSigned = (horizon: "days1" | "days3" | "days5") =>
      rows.reduce((s, r) => s + rowSignedReturn(r, horizon), 0) / n;
    const hitRate5d =
      rows.filter((r) => rowSignedReturn(r, "days5") > 0).length /
      Math.max(n, 1);
    return {
      itemCode,
      direction,
      sampleCount: n,
      avgReturn1d: avgSigned("days1"),
      avgReturn3d: avgSigned("days3"),
      avgReturn5d: avgSigned("days5"),
      hitRate5d,
    };
  });
}

export function summarizeByItemCodeAndPolarity(
  results: ForwardReturnResult[],
): ItemCodeDirectionSummary[] {
  const byKey = new Map<string, ForwardReturnResult[]>();
  for (const row of results) {
    for (const code of row.filing.itemCodes) {
      const polarity = row.filing.polarity ?? "unknown";
      const direction = row.filing.direction ?? "long";
      const key = `${code}|${polarity}|${direction}`;
      const list = byKey.get(key) ?? [];
      list.push(row);
      byKey.set(key, list);
    }
  }

  return [...byKey.entries()].map(([key, rows]) => {
    const [itemCode, polarity, direction] = key.split("|") as [
      string,
      FilingPolarity,
      TradeDirection,
    ];
    const n = rows.length;
    const avgSigned = (pick: (r: ForwardReturnResult) => number) =>
      rows.reduce((s, r) => s + pick(r), 0) / n;
    return {
      itemCode,
      direction,
      polarity,
      sampleCount: n,
      avgReturn1d: avgSigned((r) => r.signedReturns.days1),
      avgReturn3d: avgSigned((r) => r.signedReturns.days3),
      avgReturn5d: avgSigned((r) => r.signedReturns.days5),
      hitRate5d:
        rows.filter((r) => r.signedReturns.days5 > 0).length / Math.max(n, 1),
    };
  });
}

/** Brier score for confidence vs binary 5d hit outcome (direction-aware). */
export function computeConfidenceCalibration(
  labeled: Array<{ confidence: number; hit5d: boolean }>,
  bucketSize = 0.1,
): ConfidenceCalibrationBucket[] {
  const buckets = new Map<string, typeof labeled>();
  for (const row of labeled) {
    const bucketKey = `${Math.floor(row.confidence / bucketSize) * bucketSize}`;
    const list = buckets.get(bucketKey) ?? [];
    list.push(row);
    buckets.set(bucketKey, list);
  }

  return [...buckets.entries()].map(([bucket, rows]) => {
    const count = rows.length;
    const avgConfidence =
      rows.reduce((s, r) => s + r.confidence, 0) / Math.max(count, 1);
    const hitRate = rows.filter((r) => r.hit5d).length / Math.max(count, 1);
    const brierScore =
      rows.reduce((s, r) => s + (r.confidence - (r.hit5d ? 1 : 0)) ** 2, 0) /
      Math.max(count, 1);
    return { bucket, count, avgConfidence, hitRate, brierScore };
  });
}

export type HoldPeriodSweepResult = {
  holdDays: number;
  sampleCount: number;
  avgReturn: number;
  hitRate: number;
};

export function runHoldPeriodSweep(
  results: ForwardReturnResult[],
  holdDays: number[],
): HoldPeriodSweepResult[] {
  return holdDays.map((days) => {
    const returns = results.map((row) => {
      const retKey =
        days === 1
          ? row.signedReturns.days1
          : days === 3
            ? row.signedReturns.days3
            : row.signedReturns.days5;
      return retKey;
    });
    const sampleCount = returns.length;
    const avgReturn =
      returns.reduce((sum, value) => sum + value, 0) / Math.max(sampleCount, 1);
    const hitRate =
      returns.filter((value) => value > 0).length / Math.max(sampleCount, 1);
    return { holdDays: days, sampleCount, avgReturn, hitRate };
  });
}

export type RegimeSliceSummary = {
  regime: string;
  sampleCount: number;
  avgReturn5d: number;
  hitRate5d: number;
};

export type RegimeSliceKind =
  | "market_cap"
  | "gap_size"
  | "prior_momentum"
  | "realized_volatility";

export function sliceByRegime(
  results: ForwardReturnResult[],
  kind: RegimeSliceKind = "market_cap",
): RegimeSliceSummary[] {
  const buckets = new Map<string, ForwardReturnResult[]>();
  for (const row of results) {
    const regime = classifyRegime(row, kind);
    const list = buckets.get(regime) ?? [];
    list.push(row);
    buckets.set(regime, list);
  }
  return [...buckets.entries()].map(([regime, rows]) => ({
    regime,
    sampleCount: rows.length,
    avgReturn5d:
      rows.reduce((sum, row) => sum + row.signedReturns.days5, 0) /
      Math.max(rows.length, 1),
    hitRate5d:
      rows.filter((row) => row.signedReturns.days5 > 0).length /
      Math.max(rows.length, 1),
  }));
}

function classifyRegime(
  row: ForwardReturnResult,
  kind: RegimeSliceKind,
): string {
  switch (kind) {
    case "market_cap":
      return row.filing.marketCapBucket ?? "unknown";
    case "gap_size": {
      const gap = row.reaction.gapPct;
      if (gap == null) return "unknown";
      if (gap >= 0.03) return "gap_up_large";
      if (gap >= 0.01) return "gap_up_small";
      if (gap <= -0.03) return "gap_down_large";
      if (gap <= -0.01) return "gap_down_small";
      return "flat_open";
    }
    case "prior_momentum": {
      const r1 = row.returns.days1;
      if (r1 >= 0.02) return "momentum_up";
      if (r1 <= -0.02) return "momentum_down";
      return "momentum_neutral";
    }
    case "realized_volatility": {
      const absGap = Math.abs(row.reaction.gapPct ?? 0);
      const volZ = Math.abs(row.reaction.volumeZScore ?? 0);
      const score = absGap * 10 + volZ;
      if (score >= 2) return "high_vol";
      if (score >= 1) return "medium_vol";
      return "low_vol";
    }
    default:
      return "unknown";
  }
}

export type AblationMode =
  | "item_code_only"
  | "item_code_rules"
  | "item_code_llm"
  | "item_code_llm_price";

export type AblationReport = {
  mode: AblationMode;
  sampleCount: number;
  avgReturn5d: number;
  hitRate5d: number;
};

/** Rules-only EDGAR decision: positive polarity long, negative short, else skip. */
export function rulesEdgarDecision(
  filing: FilingRecord,
): TradeDirection | null {
  const enriched = enrichFiling(filing);
  return polarityToDirection(enriched.polarity ?? "unknown");
}

export function runAblationReport(
  results: ForwardReturnResult[],
  mode: AblationMode,
): AblationReport {
  let filtered = results;

  if (mode === "item_code_rules") {
    filtered = results.filter((row) => rulesEdgarDecision(row.filing) != null);
  } else if (mode === "item_code_llm_price") {
    filtered = results.filter((row) => {
      const r = row.reaction;
      const gapOk = (r.gapPct ?? 0) > -0.03;
      const reactionOk = (r.reaction60mPct ?? row.returns.days1) > -0.02;
      const volOk = (r.volumeZScore ?? 0) > -1;
      return gapOk && reactionOk && volOk;
    });
  } else if (mode === "item_code_only") {
    filtered = results;
  } else if (mode === "item_code_llm") {
    filtered = results.filter((row) => {
      const pol = row.filing.polarity ?? "unknown";
      return pol === "positive" || pol === "negative";
    });
  }

  const sampleCount = filtered.length;
  return {
    mode,
    sampleCount,
    avgReturn5d:
      filtered.reduce((sum, row) => sum + row.signedReturns.days5, 0) /
      Math.max(sampleCount, 1),
    hitRate5d:
      filtered.filter((row) => row.signedReturns.days5 > 0).length /
      Math.max(sampleCount, 1),
  };
}

export function summarizeDriftFeatures(results: ForwardReturnResult[]): {
  avgGapPct: number;
  avgReaction30mPct: number;
  avgReaction60mPct: number;
  avgVolumeZScore: number;
  sampleCount: number;
} {
  const n = results.length;
  const avg = (pick: (r: ForwardReturnResult) => number | null) => {
    const vals = results.map(pick).filter((v): v is number => v != null);
    return vals.reduce((s, v) => s + v, 0) / Math.max(vals.length, 1);
  };
  return {
    sampleCount: n,
    avgGapPct: avg((r) => r.reaction.gapPct),
    avgReaction30mPct: avg((r) => r.reaction.reaction30mPct),
    avgReaction60mPct: avg((r) => r.reaction.reaction60mPct),
    avgVolumeZScore: avg((r) => r.reaction.volumeZScore),
  };
}
