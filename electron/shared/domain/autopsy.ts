export type PhaseKind =
  | "thesis"
  | "execution"
  | "behavioral"
  | "market_context"
  | "synthesis";

export type LessonStatus =
  | "pending"
  | "implemented"
  | "validated"
  | "recurring"
  | "dismissed";

export type LessonSeverity = "low" | "medium" | "high" | "critical";

export type LessonCategory =
  | "strategy"
  | "execution"
  | "behavioral"
  | "risk"
  | "system";

export type ExportFormat = "markdown" | "json" | "pdf";

export type QualityGrade = "A+" | "A" | "B" | "C" | "D" | "F";

export interface PhaseTrace {
  phase: PhaseKind;
  modelId: string;
  providerKey: string;
  systemPrompt: string;
  userPrompt: string;
  toolCallsJson: string | null;
  responseText: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  error: string | null;
}

export interface AutopsyStructured {
  executiveSummary: string;
  thesisReview: {
    valid: boolean | null;
    analysis: string;
    confirmatoryBias: boolean;
    prematureConviction: boolean;
    ignoredCounterSignals: string[];
  };
  executionQuality: {
    entryTiming: "early" | "good" | "late" | "unknown";
    sizingAdequacy:
      | "oversized"
      | "appropriate"
      | "undersized"
      | "unknown";
    exitManagement: string;
    slippage: string | null;
  };
  behavioralFlags: Array<{
    flag: string;
    description: string;
    severity: LessonSeverity;
  }>;
  marketContext: {
    regime:
      | "trending"
      | "ranging"
      | "volatile"
      | "low_liquidity"
      | "unknown";
    macro: string;
    volatility: string;
    suitability: "good_conditions" | "neutral" | "poor_conditions";
  };
  whatWorked: string[];
  whatFailed: string[];
  rootCause: string | null;
  processImprovements: string[];
}

export interface TradeAutopsyRecord {
  id: string;
  tradeId: string;
  sessionId: string;
  modelId: string;
  summary: string;
  summaryStructuredJson: string;
  phaseTracesJson: string;
  qualityGrade: string | null;
  qualityScore: number | null;
  isFallback: boolean;
  createdAt: string;
  createdBy: string;
}

export interface AutopsyLesson {
  id: string;
  autopsyId: string;
  tradeId: string;
  sessionId: string;
  lesson: string;
  severity: LessonSeverity;
  category: LessonCategory;
  proposedFix: string;
  status: LessonStatus;
  recurrenceCount: number;
  createdAt: string;
  updatedAt: string;
  validatedAt: string | null;
}

export interface AddLessonInput {
  autopsyId: string;
  tradeId: string;
  sessionId: string;
  lesson: string;
  severity: LessonSeverity;
  category: LessonCategory;
  proposedFix: string;
}

export interface UpdateLessonInput {
  lessonId: string;
  status?: LessonStatus;
  lesson?: string;
  proposedFix?: string;
}

export type ExportResult =
  | { path: string; filename: string }
  | { cancelled: true }
  | { error: string };

export interface AndonCordPayload {
  lessonId: string;
  lessonText: string;
  recurrenceCount: number;
  sessionId: string;
}
