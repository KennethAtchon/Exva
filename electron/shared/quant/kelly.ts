/**
 * Fractional-Kelly position sizing (P6). Kelly maximizes long-run log growth
 * only when probabilities are KNOWN; Exva's probabilities are estimated with
 * model error, so we always use a fraction of full Kelly and apply uncertainty
 * and correlation haircuts. Never full Kelly in this system.
 */

/**
 * Raw Kelly fraction for a binary bet: f* = (b*p - q) / b, where p is win
 * probability, q = 1 - p, and b is net odds (payout per unit risked).
 * Clamped to [0, 1]; negative edge returns 0 (no bet).
 */
export function kellyFractionBinary(
  winProbability: number,
  netOdds: number,
): number {
  if (netOdds <= 0) return 0;
  const p = clamp01(winProbability);
  const q = 1 - p;
  const f = (netOdds * p - q) / netOdds;
  return Math.max(0, Math.min(1, f));
}

export interface CapitalAllocationInput {
  bankrollUsd: number;
  /** Fraction of bankroll at risk per opportunity ceiling, e.g. 0.02. */
  riskBudgetPct: number;
  /** Raw Kelly fraction from the edge model. */
  rawKellyFraction: number;
  /** Kelly multiplier, e.g. 0.25 for quarter-Kelly. Never >= 1 in practice. */
  kellyMultiplier: number;
  /** Observations the edge estimate is grounded in. */
  sampleSize: number;
  /** Sample size required by the research contract for full sizing. */
  requiredSampleSize: number;
  /** Fraction of bankroll already exposed in correlated instruments [0,1]. */
  correlatedExposurePct: number;
  /** Hard caps. */
  maxPositionUsd: number;
  maxExposureRemainingUsd: number;
}

export interface CapitalAllocationResult {
  sizeUsd: number;
  fractionalKelly: number;
  uncertaintyHaircut: number;
  correlationHaircut: number;
  cappedBy: "kelly" | "max_position" | "max_exposure" | "risk_budget" | "none";
}

/**
 * Convert an edge into a small, capped, uncertainty- and correlation-adjusted
 * position size.
 *
 *   fractional_kelly   = rawKelly * kellyMultiplier
 *   uncertainty_haircut= min(1, sampleSize / requiredSampleSize)
 *   correlation_haircut= 1 - correlatedExposurePct
 *   size               = bankroll * fractional_kelly * haircuts
 *   then clamp to risk budget, max position, and remaining exposure.
 */
export function allocateCapital(
  input: CapitalAllocationInput,
): CapitalAllocationResult {
  const fractionalKelly = Math.max(
    0,
    input.rawKellyFraction * input.kellyMultiplier,
  );
  const uncertaintyHaircut =
    input.requiredSampleSize > 0
      ? Math.min(1, input.sampleSize / input.requiredSampleSize)
      : 1;
  const correlationHaircut = clamp01(1 - input.correlatedExposurePct);

  const kellySizeUsd =
    input.bankrollUsd *
    fractionalKelly *
    uncertaintyHaircut *
    correlationHaircut;
  const riskBudgetUsd = input.bankrollUsd * Math.max(0, input.riskBudgetPct);

  let sizeUsd = kellySizeUsd;
  let cappedBy: CapitalAllocationResult["cappedBy"] = "kelly";

  if (sizeUsd > riskBudgetUsd) {
    sizeUsd = riskBudgetUsd;
    cappedBy = "risk_budget";
  }
  if (sizeUsd > input.maxPositionUsd) {
    sizeUsd = input.maxPositionUsd;
    cappedBy = "max_position";
  }
  if (sizeUsd > input.maxExposureRemainingUsd) {
    sizeUsd = input.maxExposureRemainingUsd;
    cappedBy = "max_exposure";
  }
  if (sizeUsd <= 0) {
    sizeUsd = 0;
    cappedBy = "none";
  }

  return {
    sizeUsd,
    fractionalKelly,
    uncertaintyHaircut,
    correlationHaircut,
    cappedBy,
  };
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
