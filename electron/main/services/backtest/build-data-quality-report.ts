import type { BacktestDataQualityReport } from "@electron/shared/domain/backtest-data-quality";
import type { OhlcvBar } from "../broker/adapters/broker-adapter";
import { expectedBarMs } from "../operator/palette-query-service";

export interface BuildDataQualityInput {
  symbol: string;
  timeframe: string;
  windowStart: string;
  windowEnd: string;
  bars: readonly OhlcvBar[];
  provider?: string | null;
  feed?: string | null;
}

/** Build a per-symbol quality report for Backtest Lab (Solution 03). */
export function buildBacktestDataQualityReport(
  input: BuildDataQualityInput,
): BacktestDataQualityReport {
  const barMs = expectedBarMs(input.timeframe);
  const windowStartMs = Date.parse(input.windowStart);
  const windowEndMs = Date.parse(input.windowEnd);
  const expectedBars =
    Number.isFinite(windowStartMs) && Number.isFinite(windowEndMs) && barMs > 0
      ? Math.max(0, Math.floor((windowEndMs - windowStartMs) / barMs) + 1)
      : 0;

  const stamps = input.bars.map((bar) => bar.ts);
  const duplicateTimestamps = stamps.length - new Set(stamps).size;
  let outOfOrderPairs = 0;
  for (let i = 1; i < stamps.length; i++) {
    const prev = stamps[i - 1];
    const cur = stamps[i];
    if (prev && cur && cur < prev) outOfOrderPairs += 1;
  }

  const missingIntervals = detectBarGaps(stamps, input.timeframe);
  const firstTs = stamps[0] ?? null;
  const lastTs = stamps.at(-1) ?? null;
  const windowCovered =
    firstTs != null &&
    lastTs != null &&
    Date.parse(firstTs) <= windowStartMs + barMs &&
    Date.parse(lastTs) >= windowEndMs - barMs;

  const blockers: string[] = [];
  if (input.bars.length === 0) blockers.push("no_bars_in_window");
  if (!windowCovered) blockers.push("window_not_covered");
  if (missingIntervals.length > 0) {
    blockers.push(`gaps:${missingIntervals.length}`);
  }
  if (duplicateTimestamps > 0) {
    blockers.push(`duplicates:${duplicateTimestamps}`);
  }
  if (outOfOrderPairs > 0) {
    blockers.push(`out_of_order:${outOfOrderPairs}`);
  }

  const complete =
    input.bars.length > 0 &&
    windowCovered &&
    missingIntervals.length === 0 &&
    duplicateTimestamps === 0 &&
    outOfOrderPairs === 0;

  return {
    symbol: input.symbol,
    timeframe: input.timeframe,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    expectedBars,
    actualBars: input.bars.length,
    missingIntervals,
    duplicateTimestamps,
    outOfOrderPairs,
    provider: input.provider ?? null,
    feed: input.feed ?? null,
    windowCovered,
    complete,
    blockers,
  };
}

/** Gap detection aligned with Data Doctor (expected interval × 1.6 threshold). */
export function detectBarGaps(
  stamps: readonly string[],
  timeframe: string,
): Array<{ from: string; to: string }> {
  if (stamps.length < 2) return [];
  const expected = expectedBarMs(timeframe);
  const threshold = expected * 1.6;
  const gaps: Array<{ from: string; to: string }> = [];
  for (let i = 1; i < stamps.length; i++) {
    const prev = stamps[i - 1];
    const cur = stamps[i];
    if (!prev || !cur) continue;
    const delta = Date.parse(cur) - Date.parse(prev);
    if (!Number.isFinite(delta) || delta <= threshold) continue;
    if (timeframe === "1d" && isWeekendGap(prev, cur)) continue;
    gaps.push({ from: prev, to: cur });
  }
  return gaps;
}

function isWeekendGap(prevIso: string, curIso: string): boolean {
  const prev = new Date(prevIso);
  const cur = new Date(curIso);
  if (Number.isNaN(prev.getTime()) || Number.isNaN(cur.getTime())) return false;
  const prevDay = prev.getUTCDay();
  const curDay = cur.getUTCDay();
  const deltaMs = cur.getTime() - prev.getTime();
  if (
    prevDay === 5 &&
    (curDay === 1 || curDay === 2) &&
    deltaMs <= 4.5 * DAY_MS
  ) {
    return true;
  }
  if (prevDay === 4 && curDay === 1 && deltaMs <= 4.5 * DAY_MS) {
    return true;
  }
  return false;
}

const DAY_MS = 24 * 60 * 60 * 1000;
