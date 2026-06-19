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
