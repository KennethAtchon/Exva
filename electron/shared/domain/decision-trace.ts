/**
 * Structured, persisted record of every deterministic gate decision that goes
 * into a trade. Captured per cycle (a cycle that fails candidate validation
 * never produces a trade row, so the trace is keyed by cycle and linked to a
 * trade when one is created). Powers the trade-detail verdict panel and autopsy
 * observability — see docs/specs/trade-verdict-panel.md.
 */

/** Uniform pass/fail record so the UI can render any gate the same way. */
export interface DecisionCheck {
  /** Stable id, e.g. "CV-8", "concurrent_cap", "spread". */
  id: string;
  /** Human label, e.g. "Volume", "Concurrent cap". */
  label: string;
  pass: boolean;
  /** Human explanation, e.g. "8,000 < min 10,000". Null when self-evident. */
  detail: string | null;
  /** Observed value, when the check compares one. */
  value?: string | number | null;
  /** Threshold the value was compared against, when applicable. */
  threshold?: string | number | null;
}

export interface CandidateValidationTrace {
  allowed: boolean;
  checks: DecisionCheck[];
}

export interface SizingTrace {
  strategy: string;
  instrumentClass: string;
  maxPositionUsd: number;
  maxExposureUsd: number | null;
  kellyFraction: number;
  confidence: number;
  strategySizeFactor: number;
  reviewRecommendation: string | null;
  /** Position size before any caps (kelly × confidence × sizeFactor × base). */
  baseUsd: number;
  /** After a `reduce_size` review recommendation (halves base), else == base. */
  afterReviewReduceUsd: number;
  /** Final size from the execution profile after position/exposure caps. */
  finalUsd: number;
  /** Human notes, e.g. "capped to max position $100". */
  notes: string[];
}

export interface RiskGateSizeAdjustment {
  reason: string;
  fromUsd: number;
  toUsd: number;
}

export interface RiskGateTrace {
  allowed: boolean;
  reason: string | null;
  gateType: string | null;
  checks: DecisionCheck[];
  sizeAdjustments: RiskGateSizeAdjustment[];
  finalSizeUsd: number | null;
}

export interface AggregationTrace {
  classifierConfidence: number | null;
  classifierAction: string | null;
  waitForOpenThreshold: number | null;
  belowThreshold: boolean;
  timerTiming: string | null;
  timerBlocked: boolean;
  reviewRecommendation: string | null;
  finalAction: string;
  skipReason: string | null;
}

export interface OrderPolicyTrace {
  allowed: boolean;
  reason: string | null;
  checks: DecisionCheck[];
}

export interface BrokerAllocationTrace {
  allocation: { ok: boolean; reason?: string | null; warning?: string | null };
  conflict: { ok: boolean; reason?: string | null };
}

/**
 * Full decision trace for one cycle. Each field is optional because a cycle
 * that is rejected early (e.g. candidate validation) never reaches later gates.
 */
export interface TradeDecisionTrace {
  candidateValidation?: CandidateValidationTrace;
  aggregation?: AggregationTrace;
  sizing?: SizingTrace;
  riskGate?: RiskGateTrace;
  orderPolicy?: OrderPolicyTrace;
  brokerAllocation?: BrokerAllocationTrace;
  /** Pre-trade edge estimate + execution-cost hurdle (P2/P4/P5). */
  edgeEstimate?: import("./edge-estimate").EdgeEstimate;
  executionCost?: import("./edge-estimate").ExecutionCostEstimate;
  /** Capital-allocator recommendation for the order (P6). */
  capitalAllocation?: {
    recommendedSizeUsd: number;
    fractionalKelly: number;
    cappedBy: string;
  };
  /** Stop/target values used to calculate the pre-trade edge estimate. */
  effectiveRisk?: {
    stopLossPct: number;
    takeProfitPct: number;
    derivation: "explicit" | "atr_derived" | "default_fallback";
  };
}

/** Row shape persisted in the `decision_traces` table. */
export interface DecisionTraceRecord {
  cycleId: string;
  sessionId: string;
  tradeId: string | null;
  instrumentSymbol: string;
  trace: TradeDecisionTrace;
  createdAt: string;
  updatedAt: string;
}
