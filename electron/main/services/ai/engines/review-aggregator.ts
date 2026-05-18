import { z } from "zod";
import { reviewSignalSchema, type ReviewSignal } from "@electron/shared/ai/pipeline-signals";

export const conflictDetectorOutputSchema = z.object({
  technicalFundamentalConflict: z.number().min(0).max(1).nullable().default(null),
  conflictExplanation: z.string().nullable().default(null),
  rawSummary: z.string().default(""),
});
export type ConflictDetectorOutput = z.infer<typeof conflictDetectorOutputSchema>;

export const riskAssessorOutputSchema = z.object({
  tailRisks: z.array(z.string()).default([]),
  overallRisk: z.enum(["low", "medium", "high"]).nullable().default(null),
  rawSummary: z.string().default(""),
});
export type RiskAssessorOutput = z.infer<typeof riskAssessorOutputSchema>;

export interface ReviewWorkerOutputs {
  conflictDetector?: ConflictDetectorOutput | null;
  riskAssessor?: RiskAssessorOutput | null;
}

export function aggregateReviewSignal(symbol: string, workers: ReviewWorkerOutputs): ReviewSignal {
  const conflict = workers.conflictDetector?.technicalFundamentalConflict ?? null;
  const overallRisk = workers.riskAssessor?.overallRisk ?? null;
  const tailRisks = workers.riskAssessor?.tailRisks ?? [];

  const recommendation = deriveRecommendation(conflict, overallRisk, workers);
  const rawSummary = buildRawSummary(workers);

  return reviewSignalSchema.parse({
    symbol,
    technicalFundamentalConflict: conflict,
    conflictExplanation: workers.conflictDetector?.conflictExplanation ?? null,
    tailRisks,
    overallRisk,
    recommendation,
    rawSummary,
  });
}

function deriveRecommendation(
  conflict: number | null,
  overallRisk: "low" | "medium" | "high" | null,
  workers: ReviewWorkerOutputs,
): "proceed" | "reduce_size" | "skip" {
  const noEvidence = workers.conflictDetector == null && workers.riskAssessor == null;
  if (noEvidence) return "skip";

  const highConflict = conflict != null && conflict >= 0.7;
  const highRisk = overallRisk === "high";

  if (highConflict && highRisk) return "skip";
  if (highConflict || highRisk) return "reduce_size";
  return "proceed";
}

function buildRawSummary(workers: ReviewWorkerOutputs): string {
  const parts: string[] = [];
  if (workers.conflictDetector?.rawSummary) parts.push(`Conflict: ${workers.conflictDetector.rawSummary}`);
  if (workers.riskAssessor?.rawSummary) parts.push(`Risk: ${workers.riskAssessor.rawSummary}`);
  return parts.join(" | ");
}
