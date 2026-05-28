import { z } from "zod";

export type PhaseKind =
  | "thesis"
  | "execution"
  | "behavioral"
  | "market_context"
  | "pattern_analysis"
  | "pattern_analysis_pass1"
  | "pattern_analysis_pass2"
  | "lesson_validation"
  | "synthesis";

export type AutopsyScope = "global" | "session";

export type AutopsyLessonSource = "trade" | "period" | "manual";

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
    sizingAdequacy: "oversized" | "appropriate" | "undersized" | "unknown";
    exitManagement: string;
    slippage: string | null;
  };
  behavioralFlags: Array<{
    flag: string;
    description: string;
    severity: LessonSeverity;
  }>;
  marketContext: {
    regime: "trending" | "ranging" | "volatile" | "low_liquidity" | "unknown";
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

export interface PeriodLessonInput {
  lesson: string;
  severity: LessonSeverity;
  category: LessonCategory;
  proposedFix: string;
}

export interface PeriodAutopsyFilters {
  instrumentClasses: string[];
  brokerAccountIds: string[];
  outcome: "all" | "winners" | "losers";
  minPositionSizeUsd: number;
  includeAgentPhases: string[];
}

export interface PeriodAutopsyStructured {
  executiveSummary: string;
  performancePatterns: {
    winRate: number;
    totalTrades: number;
    winners: number;
    losers: number;
    avgPnlUsd: number;
    bestPnlUsd: number;
    worstPnlUsd: number;
    avgHoldDurationMs: number;
    sizingConsistency: string;
    entryTimingPattern: string;
    regimeNotes: string;
  };
  recurringFailureModes: Array<{
    category: string;
    count: number;
    description: string;
    tradeIds: string[];
  }>;
  lessonsNew: PeriodLessonInput[];
  lessonsValidated: string[];
  lessonsRecurring: string[];
  andonAssessment: {
    shouldFire: boolean;
    reasons: Array<{
      lessonId: string;
      lessonText: string;
      recurrenceCount: number;
    }>;
  };
  processImprovements: string[];
}

export interface PeriodAutopsyRecord {
  id: string;
  scope: AutopsyScope;
  sessionId: string | null;
  windowStart: string;
  windowEnd: string;
  modelId: string;
  filtersJson: string;
  tradeCount: number;
  tradeIdsJson: string;
  summaryStructuredJson: string;
  phaseTracesJson: string;
  qualityGrade: string | null;
  qualityScore: number | null;
  isFallback: boolean;
  totalCostUsd: number;
  createdAt: string;
  createdBy: string;
}

export interface AutopsyLesson {
  id: string;
  autopsyId: string | null;
  periodAutopsyId: string | null;
  tradeId: string | null;
  sessionId: string | null;
  lesson: string;
  severity: LessonSeverity;
  category: LessonCategory;
  proposedFix: string;
  status: LessonStatus;
  recurrenceCount: number;
  source: AutopsyLessonSource;
  scope: AutopsyScope;
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

export interface PeriodAutopsyRunInput {
  scope: AutopsyScope;
  sessionId?: string;
  windowStart: string;
  windowEnd: string;
  filters: PeriodAutopsyFilters;
  providerKey?: string;
  modelId?: string;
  confirmHighCost?: boolean;
}

export interface PeriodAutopsyListInput {
  scope: AutopsyScope;
  sessionId?: string;
  limit?: number;
  offset?: number;
}

export interface PeriodAutopsyLessonsListInput {
  scope: AutopsyScope;
  sessionId?: string;
  status?: LessonStatus[];
}

export interface PeriodAutopsyAddLessonInput {
  scope: AutopsyScope;
  sessionId?: string;
  lesson: string;
  severity: LessonSeverity;
  category: LessonCategory;
  proposedFix: string;
}

export interface PeriodAutopsyPromoteLessonInput {
  lessonId: string;
  targetScope: AutopsyScope;
  targetSessionId?: string;
}

export interface PeriodAutopsyPreview {
  tradeCount: number;
  estimatedPromptTokens: number;
  estimatedCostUsd: number;
  lastAutopsyAt: string | null;
  lastAutopsyTradeCount: number;
}

export type ExportResult =
  | { path: string; filename: string }
  | { cancelled: true }
  | { error: string };

export interface AndonCordPayload {
  lessonId: string;
  lessonText: string;
  recurrenceCount: number;
  sessionId: string | null;
  scope: AutopsyScope;
  periodAutopsyId: string;
  severity: LessonSeverity;
}

const phaseTraceSchema = z.object({
  phase: z.enum([
    "thesis",
    "execution",
    "behavioral",
    "market_context",
    "pattern_analysis",
    "pattern_analysis_pass1",
    "pattern_analysis_pass2",
    "lesson_validation",
    "synthesis",
  ]),
  modelId: z.string(),
  providerKey: z.string(),
  systemPrompt: z.string(),
  userPrompt: z.string(),
  toolCallsJson: z.string().nullable(),
  responseText: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number(),
  durationMs: z.number(),
  error: z.string().nullable(),
});

const autopsyStructuredSchema = z.object({
  executiveSummary: z.string(),
  thesisReview: z.object({
    valid: z.boolean().nullable(),
    analysis: z.string(),
    confirmatoryBias: z.boolean(),
    prematureConviction: z.boolean(),
    ignoredCounterSignals: z.array(z.string()),
  }),
  executionQuality: z.object({
    entryTiming: z.enum(["early", "good", "late", "unknown"]),
    sizingAdequacy: z.enum([
      "oversized",
      "appropriate",
      "undersized",
      "unknown",
    ]),
    exitManagement: z.string(),
    slippage: z.string().nullable(),
  }),
  behavioralFlags: z.array(
    z.object({
      flag: z.string(),
      description: z.string(),
      severity: z.enum(["low", "medium", "high", "critical"]),
    }),
  ),
  marketContext: z.object({
    regime: z.enum([
      "trending",
      "ranging",
      "volatile",
      "low_liquidity",
      "unknown",
    ]),
    macro: z.string(),
    volatility: z.string(),
    suitability: z.enum(["good_conditions", "neutral", "poor_conditions"]),
  }),
  whatWorked: z.array(z.string()),
  whatFailed: z.array(z.string()),
  rootCause: z.string().nullable(),
  processImprovements: z.array(z.string()),
});

const periodLessonInputSchema = z.object({
  lesson: z.string(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  category: z.enum(["strategy", "execution", "behavioral", "risk", "system"]),
  proposedFix: z.string(),
});

const periodAutopsyStructuredSchema = z.object({
  executiveSummary: z.string(),
  performancePatterns: z.object({
    winRate: z.number(),
    totalTrades: z.number(),
    winners: z.number(),
    losers: z.number(),
    avgPnlUsd: z.number(),
    bestPnlUsd: z.number(),
    worstPnlUsd: z.number(),
    avgHoldDurationMs: z.number(),
    sizingConsistency: z.string(),
    entryTimingPattern: z.string(),
    regimeNotes: z.string(),
  }),
  recurringFailureModes: z.array(
    z.object({
      category: z.string(),
      count: z.number(),
      description: z.string(),
      tradeIds: z.array(z.string()),
    }),
  ),
  lessonsNew: z.array(periodLessonInputSchema),
  lessonsValidated: z.array(z.string()),
  lessonsRecurring: z.array(z.string()),
  andonAssessment: z.object({
    shouldFire: z.boolean(),
    reasons: z.array(
      z.object({
        lessonId: z.string(),
        lessonText: z.string(),
        recurrenceCount: z.number(),
      }),
    ),
  }),
  processImprovements: z.array(z.string()),
});

export function parseAutopsyStructuredJson(
  json: string,
): AutopsyStructured | null {
  try {
    const parsed = JSON.parse(json) as unknown;
    return autopsyStructuredSchema.parse(parsed);
  } catch {
    return null;
  }
}

export function parsePeriodAutopsyStructuredJson(
  json: string,
): PeriodAutopsyStructured | null {
  try {
    const parsed = JSON.parse(json) as unknown;
    return periodAutopsyStructuredSchema.parse(parsed);
  } catch {
    return null;
  }
}

export function parsePhaseTracesJson(json: string): PhaseTrace[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return z.array(phaseTraceSchema).parse(parsed);
  } catch {
    return [];
  }
}
