import type { OffHoursTrading } from "../domain/session";
import { isUsMarketHoliday } from "./us-market-holidays";

/**
 * Trading session state for US equities, in America/New_York terms.
 *
 * - `regular` — RTH, 09:30–16:00 ET on a non-holiday weekday.
 * - `extended` — pre-market (04:00–09:30) or post-market (16:00–20:00) on a
 *   non-holiday weekday. Tradable only with limit orders + `extended_hours`.
 * - `closed` — overnight, weekends, and holidays. No equity execution.
 */
export type UsEquitySession = "regular" | "extended" | "closed";

const REGULAR_OPEN_MIN = 9 * 60 + 30; // 09:30 ET
const REGULAR_CLOSE_MIN = 16 * 60; // 16:00 ET
const EXTENDED_OPEN_MIN = 4 * 60; // 04:00 ET
const EXTENDED_CLOSE_MIN = 20 * 60; // 20:00 ET

/**
 * Classify the current US equity trading session. Single source of truth shared
 * by the selector's market-hours guard and broker adapters so order-type
 * decisions (market vs. extended-hours limit) and tradability never diverge.
 */
export function getUsEquitySession(now: Date = new Date()): UsEquitySession {
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return "closed";
  if (isUsMarketHoliday(now)) return "closed";

  const ny = new Date(
    now.toLocaleString("en-US", { timeZone: "America/New_York" }),
  );
  const minutes = ny.getHours() * 60 + ny.getMinutes();

  if (minutes >= REGULAR_OPEN_MIN && minutes < REGULAR_CLOSE_MIN) {
    return "regular";
  }
  if (minutes >= EXTENDED_OPEN_MIN && minutes < EXTENDED_CLOSE_MIN) {
    return "extended";
  }
  return "closed";
}

/**
 * Whether US equities can be traded at `now` under the given off-hours policy.
 * Mirrors the selector's market-hours guard: regular hours are always tradable;
 * the extended (pre/post-market) window is tradable only when the session opts
 * into `extended_hours`.
 */
export function isEquityTradable(
  now: Date,
  offHoursTrading: OffHoursTrading = "disabled",
): boolean {
  const session = getUsEquitySession(now);
  if (session === "regular") return true;
  return session === "extended" && offHoursTrading === "extended_hours";
}

/** ~14 days covers any weekend + adjacent holiday gap with margin. */
const NEXT_OPEN_LOOKAHEAD_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Earliest minute-aligned instant at or after `now` when US equities are
 * tradable under `offHoursTrading`. Used to wake a market-closed session
 * exactly at the open instead of polling on a fixed interval.
 *
 * Steps minute-by-minute (session boundaries — 04:00 / 09:30 ET — fall on
 * minute boundaries, so the first tradable minute is exact) and reuses
 * {@link isEquityTradable} so this never diverges from the live guard. Returns
 * null only if nothing is tradable within the lookahead window (defensive; the
 * holiday calendar guarantees an open well inside it).
 */
export function nextEquityMarketOpen(
  now: Date,
  offHoursTrading: OffHoursTrading = "disabled",
): Date | null {
  if (isEquityTradable(now, offHoursTrading)) return now;

  const start = new Date(now);
  start.setUTCSeconds(0, 0);
  const deadline = now.getTime() + NEXT_OPEN_LOOKAHEAD_MS;
  for (let t = start.getTime() + 60_000; t <= deadline; t += 60_000) {
    const candidate = new Date(t);
    if (isEquityTradable(candidate, offHoursTrading)) return candidate;
  }
  return null;
}
