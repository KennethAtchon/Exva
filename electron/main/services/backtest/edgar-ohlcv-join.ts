import {
  computeForwardReturns,
  type FilingRecord,
  type ForwardReturnResult,
  type OhlcvBar,
} from "./edgar-drift-backtest";

export type OhlcvByTicker = ReadonlyMap<string, readonly OhlcvBar[]>;

/** Join historical filings with per-ticker daily bars for drift analytics. */
export function joinFilingsWithOhlcv(
  filings: readonly FilingRecord[],
  barsByTicker: OhlcvByTicker,
  latencyMinutes = 10,
): ForwardReturnResult[] {
  const results: ForwardReturnResult[] = [];
  for (const filing of filings) {
    const bars = barsByTicker.get(filing.ticker);
    if (!bars?.length) continue;
    const joined = computeForwardReturns(filing, [...bars], latencyMinutes);
    if (joined) results.push(joined);
  }
  return results;
}
