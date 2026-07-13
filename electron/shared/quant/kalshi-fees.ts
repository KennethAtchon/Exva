/**
 * Kalshi general trading fee (taker / immediately matched):
 *   fees = round_up(0.07 × C × P × (1 − P))
 * where C = contracts, P = price in dollars, round_up = next cent.
 * Maker coefficient on maker-fee markets: 0.0175.
 */

export const KALSHI_TAKER_FEE_COEFF = 0.07;
const KALSHI_MAKER_FEE_COEFF = 0.0175;

/** Round up to the next cent (Kalshi fee schedule). */
export function roundUpToCent(usd: number): number {
  if (!(usd > 0)) return 0;
  return Math.ceil(usd * 100 - 1e-9) / 100;
}

export function kalshiTradingFeeUsd(input: {
  contracts: number;
  price: number;
  /** Default taker (0.07). Pass maker coeff for resting fills on maker markets. */
  coefficient?: number;
}): number {
  const coeff = input.coefficient ?? KALSHI_TAKER_FEE_COEFF;
  const p = input.price;
  if (!(input.contracts > 0) || !(p > 0) || p >= 1) return 0;
  return roundUpToCent(coeff * input.contracts * p * (1 - p));
}

/** Maker fee using the 0.0175 coefficient on maker-fee markets. */
export function kalshiMakerFeeUsd(contracts: number, price: number): number {
  return kalshiTradingFeeUsd({
    contracts,
    price,
    coefficient: KALSHI_MAKER_FEE_COEFF,
  });
}

/**
 * Approximate fee as bps of notional for cost-model / edge-gate inputs.
 * Uses mid price; at P=0.50 one contract notional is $0.50.
 */
export function kalshiFeeBpsAtPrice(price: number, contracts = 1): number {
  const notional = contracts * price;
  if (!(notional > 0)) return 0;
  const fee = kalshiTradingFeeUsd({ contracts, price });
  return (fee / notional) * 10_000;
}

/** Default commission bps for research contracts targeting Kalshi (~P=0.50). */
export function kalshiDefaultCommissionBps(): number {
  return Math.round(kalshiFeeBpsAtPrice(0.5, 1));
}
