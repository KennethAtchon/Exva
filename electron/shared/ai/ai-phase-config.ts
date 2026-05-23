import type { PipelinePhase } from "./ai-phase";

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

/** Raised caps for paper/mock rehearsal until provider-reported cost is trusted. */
export const PAPER_MOCK_BUDGETS = {
  totalSpendCapUsd: 25.0,
  phases: {
    selector: 5.0,
    technical: 2.0,
    fundamental: 2.0,
    review: 1.0,
    decision: 1.0,
  },
  workerCaps: {
    selector: { spendLimitUsd: 3.0, maxSteps: 50 },
    trade: { spendLimitUsd: 2.0, maxSteps: 50 },
  },
  sessionMaxAiSpendUsd: 50.0,
} as const;

export function isSandboxBudgetProfile(input: {
  sandboxMode?: boolean;
  isMockSession?: boolean;
}): boolean {
  return Boolean(input.sandboxMode || input.isMockSession);
}

export function resolveTotalSpendCapUsd(sandbox: boolean): number {
  return sandbox
    ? PAPER_MOCK_BUDGETS.totalSpendCapUsd
    : DEFAULT_PIPELINE_CONFIG.totalSpendCapUsd;
}

export function phaseSpendCapUsd(phase: PipelinePhase): number {
  return DEFAULT_PIPELINE_CONFIG.phases[phase].phaseSpendCapUsd;
}

export function resolvePhaseSpendCapUsd(
  phase: PipelinePhase,
  sandbox = false,
): number {
  if (sandbox) {
    return PAPER_MOCK_BUDGETS.phases[phase];
  }
  return phaseSpendCapUsd(phase);
}

/** Shared read-only engine bindings for worker definitions. */
export const ENGINE_BINDINGS = {
  riskSummaryRead: {
    engine: "risk-summary",
    kind: "context",
    mode: "read",
  } as const,
  reviewAggregatorFinalize: {
    engine: "review-aggregator",
    kind: "transformer",
    mode: "finalize",
  } as const,
  tradeSignalAggregatorFinalize: {
    engine: "trade-signal-aggregator",
    kind: "transformer",
    mode: "finalize",
  } as const,
  technicalAggregatorFinalize: {
    engine: "technical-aggregator",
    kind: "transformer",
    mode: "finalize",
  } as const,
  fundamentalAggregatorFinalize: {
    engine: "fundamental-aggregator",
    kind: "transformer",
    mode: "finalize",
  } as const,
};
