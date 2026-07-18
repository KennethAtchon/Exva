const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactFmt = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const timestampFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

function currencyFormatter(currency: string, fractionDigits: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** Fixed-decimal number (no unit). */
export function formatFixed(value: number, fractionDigits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** Format a currency amount. Defaults to USD with 2 fraction digits. */
export function formatCurrency(
  value: number,
  currency = "USD",
  fractionDigits = 2,
): string {
  if (!Number.isFinite(value)) return "—";
  if (currency === "USD" && fractionDigits === 2) {
    return currencyFmt.format(value);
  }
  return currencyFormatter(currency, fractionDigits).format(value);
}

/**
 * Format a ratio as a percent.
 * Pass `0.123` for 12.3%. Set `asRatio: false` when the value is already percent points.
 */
export function formatPercent(
  value: number,
  fractionDigits = 1,
  options?: { asRatio?: boolean; showSign?: boolean },
): string {
  if (!Number.isFinite(value)) return "—";
  const asRatio = options?.asRatio ?? true;
  const showSign = options?.showSign ?? false;
  const pct = asRatio ? value * 100 : value;
  const abs = Math.abs(pct).toFixed(fractionDigits);
  if (showSign) {
    const sign = pct > 0 ? "+" : pct < 0 ? "-" : "";
    return `${sign}${abs}%`;
  }
  return `${pct < 0 ? "-" : ""}${abs}%`;
}

/** Compact notation (1.2K, 3.4M). */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return compactFmt.format(value);
}

/** Short absolute timestamp from an ISO string or Date. */
export function formatTimestamp(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  return timestampFmt.format(d);
}

const RELATIVE_DIVISIONS: Array<{
  amount: number;
  unit: Intl.RelativeTimeFormatUnit;
}> = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
];

/** Relative time from an ISO string or Date (e.g. "3 minutes ago"). */
export function formatRelative(iso: string | Date, now = Date.now()): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "—";
  let duration = (d.getTime() - now) / 1000;
  for (const division of RELATIVE_DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return rtf.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }
  return rtf.format(Math.round(duration), "year");
}

/** Signed PnL currency string (+$1.23 / -$1.23). */
export function formatPnl(value: number, currency = "USD"): string {
  if (!Number.isFinite(value)) return "—";
  const formatted = formatCurrency(Math.abs(value), currency);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}
