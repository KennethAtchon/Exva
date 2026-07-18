import {
  formatCompact,
  formatCurrency,
  formatPercent,
  formatPnl,
  formatRelative,
  formatTimestamp,
} from "@/lib/format";

/** Legacy shorthand used across panels — backed by `src/lib/format.ts`. */
export const fmt = {
  usd: (v: number, d = 2): string => formatCurrency(v, "USD", d),
  pct: (v: number, d = 1): string =>
    formatPercent(v, d, { asRatio: true, showSign: true }),
  pnl: (v: number): string => formatPnl(v),
  time: (iso: string): string =>
    new Date(iso).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
  tokens: (n: number): string => (n >= 1000 ? formatCompact(n) : `${n}`),
  duration: (ms: number): string =>
    ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`,
  uptime: (m: number): string => {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
  },
  timestamp: formatTimestamp,
  relative: formatRelative,
  compact: formatCompact,
  percent: formatPercent,
};
