export const fmt = {
  usd: (v: number, d = 2): string => {
    const a = Math.abs(v).toFixed(d);
    return v < 0 ? `-$${a}` : `$${a}`;
  },
  pct: (v: number, d = 1): string =>
    `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`,
  pnl: (v: number): string => (v >= 0 ? `+${fmt.usd(v)}` : fmt.usd(v)),
  time: (iso: string): string =>
    new Date(iso).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }),
  tokens: (n: number): string =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`,
  duration: (ms: number): string =>
    ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`,
  uptime: (m: number): string => {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
  },
};
