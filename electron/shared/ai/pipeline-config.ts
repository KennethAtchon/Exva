import type { PipelinePhase } from "./pipeline-phase";

/** Weighting for selector candidate scoring dimensions. */
export interface ScoringWeights {
  hype: number;
  volume: number;
  catalyst: number;
  liquidity: number;
}

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  hype: 0.2,
  volume: 0.3,
  catalyst: 0.35,
  liquidity: 0.15,
};

/** Deterministic selector risk-filter thresholds (not model-controlled). */
export interface RiskRuleSet {
  minFinalScore: number;
}

export const DEFAULT_RISK_RULE_SET: RiskRuleSet = {
  minFinalScore: 0.15,
};

export interface PhaseSpendConfig {
  phaseSpendCapUsd: number;
}

export interface WorkerToolBinding {
  /** Fallback search provider when the session primary adapter errors (e.g. MCP 5xx). */
  fallbackProviderId?: string;
}

export interface WorkerToolConfig {
  search_web?: WorkerToolBinding;
}

export interface WorkerConfig {
  id: string;
  toolConfig?: WorkerToolConfig;
}

export interface PhaseConfig extends PhaseSpendConfig {
  phase: PipelinePhase;
}

export interface PipelineConfig {
  totalSpendCapUsd: number;
  scoringWeights: ScoringWeights;
  riskRules: RiskRuleSet;
  phases: Record<PipelinePhase, PhaseSpendConfig>;
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  totalSpendCapUsd: 0.5,
  scoringWeights: DEFAULT_SCORING_WEIGHTS,
  riskRules: DEFAULT_RISK_RULE_SET,
  phases: {
    selector: { phaseSpendCapUsd: 0.3 },
    technical: { phaseSpendCapUsd: 0.08 },
    fundamental: { phaseSpendCapUsd: 0.08 },
    review: { phaseSpendCapUsd: 0.05 },
    decision: { phaseSpendCapUsd: 0.05 },
  },
};

export function phaseSpendCapUsd(phase: PipelinePhase): number {
  return DEFAULT_PIPELINE_CONFIG.phases[phase].phaseSpendCapUsd;
}

/** Shared read-only engine bindings for worker definitions. */
export const ENGINE_BINDINGS = {
  riskSummaryRead: { engine: "risk-summary", kind: "context", mode: "read" } as const,
  reviewAggregatorFinalize: { engine: "review-aggregator", kind: "transformer", mode: "finalize" } as const,
  tradeSignalAggregatorFinalize: { engine: "trade-signal-aggregator", kind: "transformer", mode: "finalize" } as const,
  technicalAggregatorFinalize: { engine: "technical-aggregator", kind: "transformer", mode: "finalize" } as const,
  fundamentalAggregatorFinalize: { engine: "fundamental-aggregator", kind: "transformer", mode: "finalize" } as const,
};
