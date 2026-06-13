/** US equity market holidays (NYSE-style, approximate). Dates are YYYY-MM-DD in America/New_York. */
export const US_MARKET_HOLIDAYS = new Set([
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-11-26",
  "2026-12-25",
]);

export function nyseHolidayKey(date: Date): string {
  const ny = new Date(
    date.toLocaleString("en-US", { timeZone: "America/New_York" }),
  );
  const year = ny.getFullYear();
  const month = String(ny.getMonth() + 1).padStart(2, "0");
  const day = String(ny.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isUsMarketHoliday(date: Date): boolean {
  return US_MARKET_HOLIDAYS.has(nyseHolidayKey(date));
}
