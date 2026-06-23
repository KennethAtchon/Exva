import type { InstrumentClass } from "./enums";

/**
 * The falsifiable research constitution for an experience. Runtime prompts,
 * backtests, paper promotion, and live readiness all read from the same
 * contract so a strategy cannot be silently tuned after seeing outcomes.
 *
 * See docs/reviews/profitability-system-review-2026-06-22.md (P0).
 */
export type SignalTimestampKind =
  | "pre_market"
  | "intraday"
  | "after_hours"
  | "continuous";

export type LabelHorizon = "1h" | "1d" | "5d" | "resolution";

export type LabelOutcome =
  | "net_return"
  | "binary_win"
  | "probability_market_resolution";

export type LabelBenchmark =
  | "cash"
  | "SPY"
  | "sector_etf"
  | "market_implied_probability";

export interface ResearchLabelSpec {
  horizon: LabelHorizon;
  outcome: LabelOutcome;
  benchmark: LabelBenchmark;
}

export interface ResearchValidationSpec {
  /** Minimum out-of-sample opportunities (incl. skips) before promotion. */
  minOutOfSampleTrades: number;
  /** Lower-bound net expectancy (USD) that must clear zero. */
  minNetExpectancyUsd: number;
  /** Lower-bound Sharpe that must clear zero. */
  minLowerBoundSharpe: number;
  maxDrawdownPct: number;
  /** Optional cap for probability-forecast experiences. */
  maxBrierScore?: number;
  requiredFolds: number;
}

export interface ResearchCostSpec {
  spreadBps: number;
  slippageBps: number;
  commissionBps: number;
  borrowBps?: number;
}

export interface ExperienceResearchContract {
  hypothesis: string;
  tradableUniverse: string[];
  instrumentClass: InstrumentClass;
  signalTimestamp: SignalTimestampKind;
  label: ResearchLabelSpec;
  validation: ResearchValidationSpec;
  costs: ResearchCostSpec;
}

/** Horizons expressed in milliseconds for label-readiness computation. */
export const LABEL_HORIZON_MS: Record<
  Exclude<LabelHorizon, "resolution">,
  number
> = {
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "5d": 5 * 24 * 60 * 60 * 1000,
};

/**
 * When is a label for an observation ready to compute? Returns null for
 * "resolution" horizons (event-driven; ready only when the market resolves).
 */
export function labelReadyAt(
  eventTimeIso: string,
  horizon: LabelHorizon,
): string | null {
  if (horizon === "resolution") return null;
  const ms = LABEL_HORIZON_MS[horizon];
  return new Date(new Date(eventTimeIso).getTime() + ms).toISOString();
}
