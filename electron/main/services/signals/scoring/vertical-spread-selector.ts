/**
 * Defined-risk vertical spread selector for options-flow v2.
 * Picks a long + short leg (same expiry, same type) with target width/debit.
 */

import type {
  OptionContract,
  ContractSelectionRule,
} from "../scoring/option-contract-selector";
import { DEFAULT_CONTRACT_RULE } from "../scoring/option-contract-selector";

export interface VerticalSpreadRule extends ContractSelectionRule {
  /** Preferred strike width in dollars (falls back to nearest available). */
  targetWidth: number;
  /** Max net debit as fraction of width (debit vertical). */
  maxDebitPctOfWidth: number;
}

export const DEFAULT_VERTICAL_RULE: VerticalSpreadRule = {
  ...DEFAULT_CONTRACT_RULE,
  targetWidth: 5,
  maxDebitPctOfWidth: 0.6,
};

export interface VerticalSpread {
  structure: "vertical";
  direction: "bullish" | "bearish";
  longLeg: OptionContract;
  shortLeg: OptionContract;
  width: number;
  netDebit: number;
  /** Max loss = net debit for long verticals. */
  maxLoss: number;
}

export interface VerticalSelectionResult {
  spread: VerticalSpread | null;
  reason: string;
}

/**
 * Select a debit vertical: buy the closer-to-ATM leg, sell further OTM.
 * Bullish → call vertical; bearish → put vertical.
 */
export function selectVerticalSpread(
  chain: readonly OptionContract[],
  direction: "buy" | "sell",
  rule: VerticalSpreadRule = DEFAULT_VERTICAL_RULE,
): VerticalSelectionResult {
  const wantType = direction === "buy" ? "call" : "put";
  const bias: "bullish" | "bearish" =
    direction === "buy" ? "bullish" : "bearish";

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

  if (eligible.length < 2) {
    return {
      spread: null,
      reason: `Need ≥2 liquid ${wantType}s for a vertical; found ${eligible.length}.`,
    };
  }

  // Group by expiry
  const byExpiry = new Map<number, OptionContract[]>();
  for (const c of eligible) {
    const list = byExpiry.get(c.daysToExpiry) ?? [];
    list.push(c);
    byExpiry.set(c.daysToExpiry, list);
  }

  let best: VerticalSpread | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const [, legs] of byExpiry) {
    if (legs.length < 2) continue;
    const sorted = [...legs].sort((a, b) => {
      // Infer strike from delta proximity isn't enough — use symbol strike if
      // embedded; otherwise sort by delta (higher delta = closer ATM for same side).
      return b.delta - a.delta;
    });

    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const longLeg = sorted[i];
        const shortLeg = sorted[j];
        if (!longLeg || !shortLeg) continue;
        // For calls: long higher delta (lower strike), short lower delta.
        // For puts: same — long higher |delta|, short lower.
        if (longLeg.delta <= shortLeg.delta) continue;

        const longMid = (longLeg.bid + longLeg.ask) / 2;
        const shortMid = (shortLeg.bid + shortLeg.ask) / 2;
        const netDebit = longMid - shortMid;
        if (netDebit <= 0) continue;

        // Approximate width from delta gap when strike unknown.
        const width = estimateWidth(longLeg, shortLeg, rule.targetWidth);
        if (width <= 0) continue;
        if (netDebit > width * rule.maxDebitPctOfWidth) continue;

        const deltaErr = Math.abs(longLeg.delta - rule.targetDelta);
        const widthErr = Math.abs(width - rule.targetWidth) / rule.targetWidth;
        const score = deltaErr + widthErr;
        if (score < bestScore) {
          bestScore = score;
          best = {
            structure: "vertical",
            direction: bias,
            longLeg,
            shortLeg,
            width,
            netDebit,
            maxLoss: netDebit,
          };
        }
      }
    }
  }

  if (!best) {
    return {
      spread: null,
      reason: `No ${wantType} vertical met width/debit/liquidity rules.`,
    };
  }

  return {
    spread: best,
    reason: `Selected ${best.longLeg.symbol}/${best.shortLeg.symbol} vertical debit $${best.netDebit.toFixed(2)} (max loss $${best.maxLoss.toFixed(2)}).`,
  };
}

/**
 * Estimate strike width. Prefer OCC strike embedded in symbol
 * (e.g. AAPL250117C00150000 → 150); else fall back to targetWidth.
 */
export function estimateWidth(
  longLeg: OptionContract,
  shortLeg: OptionContract,
  fallback: number,
): number {
  const s1 = strikeFromOcc(longLeg.symbol);
  const s2 = strikeFromOcc(shortLeg.symbol);
  if (s1 != null && s2 != null) return Math.abs(s1 - s2);
  return fallback;
}

export function strikeFromOcc(symbol: string): number | null {
  // OCC: ROOT + YYMMDD + C/P + 8-digit strike*1000
  const m = symbol.match(/[CP](\d{8})$/);
  if (!m?.[1]) return null;
  const raw = Number(m[1]);
  if (!Number.isFinite(raw)) return null;
  return raw / 1000;
}

/** Max loss for a long debit vertical equals net debit paid. */
export function verticalMaxLoss(netDebit: number): number {
  return Math.max(0, netDebit);
}

/** Credit vertical max loss = width − credit. */
export function creditVerticalMaxLoss(
  width: number,
  netCredit: number,
): number {
  return Math.max(0, width - netCredit);
}
