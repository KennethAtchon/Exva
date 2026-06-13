/**
 * Offline EDGAR 8-K drift backtest harness (audit §2.3, §7-#1).
 * Joins item-code-tagged filings with forward daily returns — no live machinery.
 */

export type FilingRecord = {
  accessionNumber: string;
  ticker: string;
  filedAt: string;
  itemCodes: string[];
  marketCapBucket?: "mega" | "large" | "mid" | "small";
};

export type OhlcvBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type ForwardReturnResult = {
  filing: FilingRecord;
  entryPrice: number;
  returns: { days1: number; days3: number; days5: number };
};

export type ItemCodeDriftSummary = {
  itemCode: string;
  sampleCount: number;
  avgReturn1d: number;
  avgReturn3d: number;
  avgReturn5d: number;
  hitRate5d: number;
};

export type ConfidenceCalibrationBucket = {
  bucket: string;
  count: number;
  avgConfidence: number;
  hitRate: number;
  brierScore: number;
};

/** Entry at next bar open after filing + latencyMinutes (default ~10 min post-filing). */
export function entryBarIndex(
  filingDate: string,
  bars: OhlcvBar[],
  latencyMinutes = 10,
): number {
  const entryMs = new Date(filingDate).getTime() + latencyMinutes * 60 * 1000;
  return bars.findIndex((bar) => new Date(bar.date).getTime() >= entryMs);
}

export function computeForwardReturns(
  filing: FilingRecord,
  bars: OhlcvBar[],
  latencyMinutes = 10,
): ForwardReturnResult | null {
  const entryIdx = entryBarIndex(filing.filedAt, bars, latencyMinutes);
  if (entryIdx < 0 || entryIdx >= bars.length) return null;
  const entryPrice = bars[entryIdx]?.open ?? bars[entryIdx]?.close;
  if (!entryPrice || entryPrice <= 0) return null;

  const ret = (offset: number) => {
    const bar = bars[entryIdx + offset];
    if (!bar) return 0;
    return (bar.close - entryPrice) / entryPrice;
  };

  return {
    filing,
    entryPrice,
    returns: { days1: ret(1), days3: ret(3), days5: ret(5) },
  };
}

export function summarizeByItemCode(
  results: ForwardReturnResult[],
): ItemCodeDriftSummary[] {
  const byCode = new Map<string, ForwardReturnResult[]>();
  for (const row of results) {
    for (const code of row.filing.itemCodes) {
      const list = byCode.get(code) ?? [];
      list.push(row);
      byCode.set(code, list);
    }
  }

  return [...byCode.entries()].map(([itemCode, rows]) => {
    const n = rows.length;
    const avg = (pick: (r: ForwardReturnResult) => number) =>
      rows.reduce((s, r) => s + pick(r), 0) / n;
    const hitRate5d =
      rows.filter((r) => r.returns.days5 > 0).length / Math.max(n, 1);
    return {
      itemCode,
      sampleCount: n,
      avgReturn1d: avg((r) => r.returns.days1),
      avgReturn3d: avg((r) => r.returns.days3),
      avgReturn5d: avg((r) => r.returns.days5),
      hitRate5d,
    };
  });
}

/** Brier score for confidence vs binary 5d hit outcome. */
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
          ? row.returns.days1
          : days === 3
            ? row.returns.days3
            : row.returns.days5;
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

export function sliceByRegime(
  results: ForwardReturnResult[],
): RegimeSliceSummary[] {
  const buckets = new Map<string, ForwardReturnResult[]>();
  for (const row of results) {
    const cap = row.filing.marketCapBucket ?? "unknown";
    const list = buckets.get(cap) ?? [];
    list.push(row);
    buckets.set(cap, list);
  }
  return [...buckets.entries()].map(([regime, rows]) => ({
    regime,
    sampleCount: rows.length,
    avgReturn5d:
      rows.reduce((sum, row) => sum + row.returns.days5, 0) /
      Math.max(rows.length, 1),
    hitRate5d:
      rows.filter((row) => row.returns.days5 > 0).length /
      Math.max(rows.length, 1),
  }));
}

export type AblationMode =
  | "item_code_only"
  | "item_code_llm"
  | "item_code_llm_price";

export type AblationReport = {
  mode: AblationMode;
  sampleCount: number;
  avgReturn5d: number;
  hitRate5d: number;
};

export function runAblationReport(
  results: ForwardReturnResult[],
  mode: AblationMode,
): AblationReport {
  let filtered = results;
  if (mode === "item_code_llm_price") {
    filtered = results.filter((row) => row.returns.days1 > -0.02);
  } else if (mode === "item_code_llm") {
    filtered = results;
  }
  const sampleCount = filtered.length;
  return {
    mode,
    sampleCount,
    avgReturn5d:
      filtered.reduce((sum, row) => sum + row.returns.days5, 0) /
      Math.max(sampleCount, 1),
    hitRate5d:
      filtered.filter((row) => row.returns.days5 > 0).length /
      Math.max(sampleCount, 1),
  };
}
