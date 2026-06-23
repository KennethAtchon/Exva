/**
 * Separates the three concepts that were previously blurred into a single
 * "confidence" number (P2):
 *
 *  - signal strength    : how unusual the setup is (z-score, liquidity)
 *  - forecast probability: estimated chance of the target outcome
 *  - expected value      : probability-weighted net return after costs
 *
 * Every trade decision should carry an EdgeEstimate so capital is allocated
 * from estimated net edge, not from a heuristic confidence score.
 */
export interface EdgeEstimate {
  modelId: string;
  modelVersion: string;
  asOf: string;
  targetHorizon: string;
  /** Calibrated probability of the target outcome, when the model produces one. */
  predictedProbability: number | null;
  expectedGrossReturnBps: number;
  expectedCostBps: number;
  expectedNetReturnBps: number;
  /** 1-sigma uncertainty on the net return estimate, in bps. */
  uncertaintyBps: number;
  /** Calibration bucket label (e.g. "0.5-0.6") when probability-based. */
  calibrationBucket: string | null;
  /** Number of historical observations the estimate is grounded in. */
  sampleSize: number;
}

/** Pre-trade execution-cost estimate, gated before risk approval (P5). */
export interface ExecutionCostEstimate {
  expectedSpreadBps: number;
  expectedSlippageBps: number;
  expectedFeeBps: number;
  expectedBorrowBps: number;
  minFillProbability: number;
  maxOrderSizeUsdAtCost: number;
}

export function totalExpectedCostBps(estimate: ExecutionCostEstimate): number {
  return (
    estimate.expectedSpreadBps +
    estimate.expectedSlippageBps +
    estimate.expectedFeeBps +
    estimate.expectedBorrowBps
  );
}

/**
 * The pre-trade edge hurdle: an edge only survives if its net return clears
 * the full execution cost plus a safety margin.
 */
export function edgeSurvivesCost(
  edge: EdgeEstimate,
  safetyMarginBps: number,
): boolean {
  return edge.expectedNetReturnBps > edge.expectedCostBps + safetyMarginBps;
}
