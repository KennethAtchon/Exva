import type { TradingTimeframe } from "@electron/shared/domain/enums";
import {
  getUsEquitySession,
  nextEquityMarketOpen,
} from "@electron/shared/instruments/us-equity-session";

export type FreshnessDecision =
  | {
      kind: "cache_fresh";
      expectedClosedBarTs: string;
      newestBarTs: string;
      lagMs: number;
    }
  | {
      kind: "provider_refresh";
      expectedClosedBarTs: string;
      newestBarTs: string | null;
      lagMs: number | null;
    }
  | {
      kind: "market_closed_fresh";
      expectedClosedBarTs: string;
      newestBarTs: string;
      lagMs: number;
    }
  | { kind: "unavailable"; reason: string };

export interface FreshnessResolveInput {
  symbol: string;
  instrumentClass: string;
  timeframe: TradingTimeframe;
  marketCalendarId: string;
  newestCachedTs: string | null;
  now: Date;
  /** Provider delay allowance in ms (default 90s for equities, 120s crypto). */
  providerDelayMs?: number;
}

const TF_MS: Record<TradingTimeframe, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "30m": 30 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
};

/**
 * Timeframe- and calendar-aware bar freshness (Solution 02 WS1).
 * Cached row count never substitutes for newest-bar currency.
 */
export class LiveBarFreshnessService {
  resolve(input: FreshnessResolveInput): FreshnessDecision {
    const delayMs =
      input.providerDelayMs ??
      (input.instrumentClass === "crypto" ? 120_000 : 90_000);
    const expected = this.expectedLatestClosedBarTs(input);
    if (!expected) {
      return { kind: "unavailable", reason: "cannot_compute_expected_bar" };
    }

    const newest = input.newestCachedTs;
    if (!newest) {
      return {
        kind: "provider_refresh",
        expectedClosedBarTs: expected,
        newestBarTs: null,
        lagMs: null,
      };
    }

    const lagMs = Date.parse(expected) - Date.parse(newest);
    const alwaysOpen =
      input.instrumentClass === "crypto" ||
      input.marketCalendarId === "always-open";

    if (!alwaysOpen) {
      const session = getUsEquitySession(input.now);
      if (session === "closed") {
        // Closed market: Friday close (or last session bar) is fresh.
        if (Date.parse(newest) >= Date.parse(expected) - delayMs) {
          return {
            kind: "market_closed_fresh",
            expectedClosedBarTs: expected,
            newestBarTs: newest,
            lagMs,
          };
        }
        return {
          kind: "provider_refresh",
          expectedClosedBarTs: expected,
          newestBarTs: newest,
          lagMs,
        };
      }
    }

    if (Date.parse(newest) >= Date.parse(expected) - delayMs) {
      return {
        kind: "cache_fresh",
        expectedClosedBarTs: expected,
        newestBarTs: newest,
        lagMs,
      };
    }

    return {
      kind: "provider_refresh",
      expectedClosedBarTs: expected,
      newestBarTs: newest,
      lagMs,
    };
  }

  /**
   * Latest completed bar open timestamp for the timeframe.
   * For equities, clamps to the last regular session when the market is closed.
   */
  expectedLatestClosedBarTs(input: FreshnessResolveInput): string | null {
    const tfMs = TF_MS[input.timeframe];
    if (!tfMs) return null;

    const alwaysOpen =
      input.instrumentClass === "crypto" ||
      input.marketCalendarId === "always-open";

    let ref = input.now.getTime() - delayFloor(input.providerDelayMs);
    if (!alwaysOpen && input.timeframe !== "1d" && input.timeframe !== "1w") {
      const session = getUsEquitySession(input.now);
      if (session === "closed") {
        // Walk back to last regular-hours minute, then align to timeframe.
        const open = nextEquityMarketOpen(input.now, "disabled");
        // Use previous close ≈ last Friday/weekday 16:00 ET approximated by
        // walking back until we find a regular session minute.
        let t = input.now.getTime();
        for (let i = 0; i < 7 * 24 * 60; i += 1) {
          t -= 60_000;
          if (getUsEquitySession(new Date(t)) === "regular") {
            ref = t;
            break;
          }
        }
        void open;
      }
    }

    if (input.timeframe === "1d") {
      // Daily bar: previous completed trading day (not the in-progress day).
      let t = input.now.getTime() - 24 * 60 * 60_000;
      for (let i = 0; i < 10; i += 1) {
        const d = new Date(t);
        if (getUsEquitySession(d) !== "closed" || alwaysOpen) {
          return startOfUtcDay(d).toISOString();
        }
        t -= 24 * 60 * 60_000;
      }
      return startOfUtcDay(new Date(ref)).toISOString();
    }

    // Align to timeframe bucket start (UTC for crypto 4h; approx for others).
    const bucketStart = Math.floor(ref / tfMs) * tfMs;
    // Expected closed bar is the previous completed bucket.
    return new Date(bucketStart - tfMs).toISOString();
  }
}

function delayFloor(providerDelayMs: number | undefined): number {
  return providerDelayMs ?? 90_000;
}

function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}
