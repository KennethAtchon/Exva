/**
 * Deterministic option-contract selector (Part D). Given a directional read and
 * a chain snapshot, pick the single OCC contract to trade. v1 is defined-risk:
 * a single long call (bullish) or long put (bearish), chosen for liquidity and
 * a target delta so max loss is the debit paid. No spreads, no short legs yet.
 *
 * Selection is pure and rule-based so it is auditable and testable: filter to
 * the right side, drop illiquid/wide contracts, then pick the contract whose
 * delta is closest to the target within the allowed expiry window.
 */

export interface OptionContract {
  /** OCC symbol, e.g. AAPL250117C00150000. */
  symbol: string;
  type: "call" | "put";
  /** Absolute delta, [0,1]. */
  delta: number;
  openInterest: number;
  bid: number;
  ask: number;
  /** Days until expiry. */
  daysToExpiry: number;
}

export interface ContractSelectionRule {
  /** Target absolute delta (e.g. 0.4 ~ slightly OTM directional). */
  targetDelta: number;
  minOpenInterest: number;
  /** Max bid/ask spread as a fraction of mid (e.g. 0.15 = 15%). */
  maxSpreadPct: number;
  minDaysToExpiry: number;
  maxDaysToExpiry: number;
}

export const DEFAULT_CONTRACT_RULE: ContractSelectionRule = {
  targetDelta: 0.4,
  minOpenInterest: 500,
  maxSpreadPct: 0.15,
  minDaysToExpiry: 7,
  maxDaysToExpiry: 45,
};

export interface ContractSelectionResult {
  contract: OptionContract | null;
  /** Why nothing was selected, for observability. */
  reason: string;
}

export function selectOptionContract(
  chain: readonly OptionContract[],
  direction: "buy" | "sell",
  rule: ContractSelectionRule = DEFAULT_CONTRACT_RULE,
): ContractSelectionResult {
  const wantType = direction === "buy" ? "call" : "put";

  const eligible = chain.filter((c) => {
    if (c.type !== wantType) return false;
    if (c.openInterest < rule.minOpenInterest) return false;
    if (c.daysToExpiry < rule.minDaysToExpiry) return false;
    if (c.daysToExpiry > rule.maxDaysToExpiry) return false;
    const mid = (c.bid + c.ask) / 2;
    if (mid <= 0) return false;
    const spreadPct = (c.ask - c.bid) / mid;
    return spreadPct <= rule.maxSpreadPct;
  });

  if (eligible.length === 0) {
    return {
      contract: null,
      reason: `No liquid ${wantType} within ${rule.minDaysToExpiry}-${rule.maxDaysToExpiry}d, OI >= ${rule.minOpenInterest}, spread <= ${(rule.maxSpreadPct * 100).toFixed(0)}%.`,
    };
  }

  // Closest delta to target; ties broken by higher open interest (more liquid).
  const best = eligible.reduce((a, b) => {
    const da = Math.abs(a.delta - rule.targetDelta);
    const db = Math.abs(b.delta - rule.targetDelta);
    if (db < da) return b;
    if (db > da) return a;
    return b.openInterest > a.openInterest ? b : a;
  });

  return {
    contract: best,
    reason: `Selected ${best.symbol} (delta ${best.delta.toFixed(2)}, OI ${best.openInterest}, ${best.daysToExpiry}d).`,
  };
}
