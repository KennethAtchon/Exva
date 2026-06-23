/** Versioned model artifact for an experience (P7). */
export interface ModelVersion {
  id: string;
  experienceId: string;
  modelKind: string;
  featureSchemaJson: string;
  trainingWindowStart: string;
  trainingWindowEnd: string;
  calibrationJson: string;
  artifactUri: string | null;
  checksum: string | null;
  createdAt: string;
}

export type BacktestVerdict = "pass" | "fail" | "inconclusive";

export interface BacktestRun {
  id: string;
  experienceId: string;
  modelVersionId: string | null;
  contractHash: string;
  windowStart: string;
  windowEnd: string;
  foldConfigJson: string;
  costModelJson: string;
  metricsJson: string;
  verdict: BacktestVerdict;
  createdAt: string;
}

export type ResearchTier = "research" | "backtest" | "paper" | "live";

export interface PromotionDecision {
  id: string;
  experienceId: string;
  modelVersionId: string | null;
  fromTier: ResearchTier;
  toTier: ResearchTier;
  decision: "approved" | "rejected";
  evidenceJson: string;
  decidedAt: string;
}
