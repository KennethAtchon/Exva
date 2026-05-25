import { z } from "zod";

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

const phaseTraceSchema = z.object({
  phase: z.enum([
    "thesis",
    "execution",
    "behavioral",
    "market_context",
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

export function parsePhaseTracesJson(json: string): PhaseTrace[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    return z.array(phaseTraceSchema).parse(parsed);
  } catch {
    return [];
  }
}
