import { z } from "zod";
import {
  reviewSignalSchema,
  type ReviewSignal,
} from "@electron/shared/ai/trade-signals";
import type { MockScenarioKind } from "@electron/shared/domain/mock-scenario";

export const conflictDetectorOutputSchema = z.object({
  technicalFundamentalConflict: z
    .number()
    .min(0)
    .max(1)
    .nullable()
    .default(null)
    .describe(
      "Degree technical and fundamental signals disagree (0 = aligned, 1 = opposed); null only if both absent.",
    ),
  conflictExplanation: z
    .string()
    .nullable()
    .default(null)
    .describe("One-sentence explanation of the conflict, or null."),
  rawSummary: z.string().default("").describe("One-sentence observation."),
});
type ConflictDetectorOutput = z.infer<typeof conflictDetectorOutputSchema>;

export const riskAssessorOutputSchema = z.object({
  tailRisks: z
    .array(z.string())
    .default([])
    .describe(
      'Specific downside risks (e.g. "earnings miss", "liquidity gap"). Empty if none.',
    ),
  overallRisk: z
    .enum(["low", "medium", "high"])
    .nullable()
    .default(null)
    .describe(
      "Aggregate risk level; null only if both input signals are entirely absent.",
    ),
  rawSummary: z.string().default("").describe("One-sentence observation."),
});
type RiskAssessorOutput = z.infer<typeof riskAssessorOutputSchema>;

export interface ReviewWorkerOutputs {
  conflictDetector?: ConflictDetectorOutput | null;
  riskAssessor?: RiskAssessorOutput | null;
}

export function aggregateReviewSignal(
  symbol: string,
  workers: ReviewWorkerOutputs,
  options?: {
    mockOverride?: MockScenarioKind;
    momentumFallbackArtifact?: boolean;
  },
): ReviewSignal {
  const conflict =
    workers.conflictDetector?.technicalFundamentalConflict ?? null;
  const overallRisk = workers.riskAssessor?.overallRisk ?? null;
  const tailRisks = workers.riskAssessor?.tailRisks ?? [];

  let recommendation = deriveRecommendation(conflict, overallRisk, workers);
  if (
    options?.mockOverride === "clean_breakout" &&
    recommendation === "reduce_size" &&
    options.momentumFallbackArtifact
  ) {
    recommendation = "proceed";
  }
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
  const noEvidence =
    workers.conflictDetector == null && workers.riskAssessor == null;
  if (noEvidence) return "skip";

  const highConflict = conflict != null && conflict > 0.7;
  const mediumConflict = conflict != null && conflict > 0.4;
  const highRisk = overallRisk === "high";
  const mediumRisk = overallRisk === "medium";

  if (highConflict || highRisk) return "skip";
  if (mediumConflict || mediumRisk) return "reduce_size";
  return "proceed";
}

function buildRawSummary(workers: ReviewWorkerOutputs): string {
  const parts: string[] = [];
  if (workers.conflictDetector?.rawSummary)
    parts.push(`Conflict: ${workers.conflictDetector.rawSummary}`);
  if (workers.riskAssessor?.rawSummary)
    parts.push(`Risk: ${workers.riskAssessor.rawSummary}`);
  return parts.join(" | ");
}
