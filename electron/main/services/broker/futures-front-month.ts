/**
 * Front-month roll helper for futures continuous roots (Solution 10 Tracer B).
 * GC/CL are concepts; the roll month must be explicit in live and backtest.
 */

const MONTH_CODES = [
  "F",
  "G",
  "H",
  "J",
  "K",
  "M",
  "N",
  "Q",
  "U",
  "V",
  "X",
  "Z",
] as const;

export type FuturesRoot = "GC" | "CL" | "ES" | "NQ" | string;

/**
 * Resolve a continuous root to a front-month contract code for a given UTC date.
 * Simple calendar rule: use the next quarterly (or monthly) contract whose
 * expiry month is strictly after `asOf`. Not a venue-accurate roll calendar —
 * that requires the partner data feed — but makes the roll *explicit*.
 */
export function resolveFrontMonthContract(
  root: FuturesRoot,
  asOf: Date = new Date(),
  opts?: { quarterly?: boolean },
): string {
  const quarterly =
    opts?.quarterly ?? (root === "ES" || root === "NQ");
  const year = asOf.getUTCFullYear();
  const month = asOf.getUTCMonth(); // 0-11

  if (quarterly) {
    const quarters = [2, 5, 8, 11]; // H, M, U, Z
    let pick = quarters.find((m) => m > month);
    let y = year;
    if (pick == null) {
      pick = quarters[0]!;
      y = year + 1;
    }
    const code = MONTH_CODES[pick]!;
    return `${root}${code}${String(y).slice(-2)}`;
  }

  // Monthly: next month
  let m = month + 1;
  let y = year;
  if (m > 11) {
    m = 0;
    y += 1;
  }
  return `${root}${MONTH_CODES[m]}${String(y).slice(-2)}`;
}

export function isContinuousFuturesRoot(symbol: string): boolean {
  return /^(GC|CL|ES|NQ)$/i.test(symbol.trim());
}
