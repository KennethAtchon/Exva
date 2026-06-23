import type { InstrumentClass } from "../domain/enums";
import type { ExecutionCostEstimate } from "../domain/edge-estimate";
import { totalExpectedCostBps } from "../domain/edge-estimate";

/**
 * Pre-trade execution-cost estimation (P5). A gross edge that disappears after
 * spread and fees is not an edge — so cost must be a first-class pre-trade
 * hurdle, not a post-trade subtraction. Especially true for small accounts,
 * crypto, prediction markets, and event-driven entries after news.
 */

export interface ExecutionCostInputs {
  instrumentClass: InstrumentClass;
  side: "BUY" | "SELL";
  orderSizeUsd: number;
  /** Observed quoted spread in bps, when available. */
  observedSpreadBps?: number | null;
  /** Contract cost assumptions (from the experience research contract). */
  contractSpreadBps: number;
  contractSlippageBps: number;
  contractCommissionBps: number;
  contractBorrowBps?: number;
  /** Expected holding period for borrow accrual. */
  holdHours?: number;
  /** Available top-of-book depth in USD, when known. */
  orderBookDepthUsd?: number | null;
}

/**
 * Build an execution-cost estimate. Uses the observed spread when present
 * (it is the live truth), otherwise the contract assumption. Slippage scales
 * up when the order is large relative to known book depth.
 */
export function estimateExecutionCost(
  inputs: ExecutionCostInputs,
): ExecutionCostEstimate {
  const expectedSpreadBps =
    inputs.observedSpreadBps != null && inputs.observedSpreadBps >= 0
      ? inputs.observedSpreadBps
      : inputs.contractSpreadBps;

  // Depth-aware slippage: if the order consumes more than the visible depth,
  // scale slippage linearly with the depth shortfall.
  let slippageMultiplier = 1;
  if (
    inputs.orderBookDepthUsd != null &&
    inputs.orderBookDepthUsd > 0 &&
    inputs.orderSizeUsd > inputs.orderBookDepthUsd
  ) {
    slippageMultiplier = inputs.orderSizeUsd / inputs.orderBookDepthUsd;
  }
  const expectedSlippageBps = inputs.contractSlippageBps * slippageMultiplier;

  const expectedFeeBps = inputs.contractCommissionBps;

  // Borrow only applies to shorts (and crypto cannot be shorted at all upstream).
  const borrowBps = inputs.contractBorrowBps ?? 0;
  const expectedBorrowBps =
    inputs.side === "SELL" && inputs.holdHours
      ? (borrowBps * inputs.holdHours) / (365 * 24)
      : 0;

  const minFillProbability =
    inputs.orderBookDepthUsd != null && inputs.orderBookDepthUsd > 0
      ? Math.min(1, inputs.orderBookDepthUsd / Math.max(1, inputs.orderSizeUsd))
      : 1;

  return {
    expectedSpreadBps,
    expectedSlippageBps,
    expectedFeeBps,
    expectedBorrowBps,
    minFillProbability,
    maxOrderSizeUsdAtCost: inputs.orderBookDepthUsd ?? inputs.orderSizeUsd,
  };
}

export interface CostGateResult {
  passes: boolean;
  reason: string | null;
  expectedCostBps: number;
}

/**
 * The pre-trade gate: skip when the expected net return does not survive the
 * full execution cost plus a safety margin.
 */
export function costGate(input: {
  expectedNetReturnBps: number;
  cost: ExecutionCostEstimate;
  safetyMarginBps: number;
}): CostGateResult {
  const expectedCostBps = totalExpectedCostBps(input.cost);
  const hurdle = expectedCostBps + input.safetyMarginBps;
  if (input.expectedNetReturnBps <= hurdle) {
    return {
      passes: false,
      reason: `edge ${input.expectedNetReturnBps.toFixed(1)}bps does not survive execution cost ${expectedCostBps.toFixed(1)}bps + margin ${input.safetyMarginBps}bps`,
      expectedCostBps,
    };
  }
  return { passes: true, reason: null, expectedCostBps };
}
