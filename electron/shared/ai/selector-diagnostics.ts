import { z } from "zod";

export const candidateRejectionSchema = z.object({
  symbol: z.string(),
  instrumentClass: z.enum(["stock", "crypto", "futures", "prediction_market"]),
  finalScore: z.number().nullable(),
  sourceWorkers: z.array(z.string()),
  toolNamesUsed: z.array(z.string()),
  reasons: z.array(z.string()),
});
export type CandidateRejection = z.infer<typeof candidateRejectionSchema>;

export const workerToolCoverageSchema = z.object({
  workerId: z.string(),
  requiredTools: z.array(z.string()),
  usedTools: z.array(z.string()),
  satisfied: z.boolean(),
});

export const selectorDiagnosticsSchema = z.object({
  discoveredCount: z.number(),
  verifiedCount: z.number(),
  acceptedCount: z.number(),
  rejected: z.array(candidateRejectionSchema),
  workerToolCoverage: z.array(workerToolCoverageSchema).optional(),
});
export type SelectorDiagnostics = z.infer<typeof selectorDiagnosticsSchema>;

export function extractToolNamesFromTraces(
  traces: Array<{ toolCalls: Array<{ tool: string }> }>,
): string[] {
  return [
    ...new Set(
      traces.flatMap((step) => step.toolCalls.map((call) => call.tool)),
    ),
  ];
}

export function collectCandidateToolNames(
  traces: Array<{ step: number; toolCalls: Array<{ tool: string }> }>,
): string[] {
  return extractToolNamesFromTraces(traces);
}
