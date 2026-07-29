import { z } from "zod";

/**
 * Pre-signal half of the no-trade funnel (Solution 05 / 06 WS4).
 *
 * `cycle-funnel.ts` explains cycles that already started. This one explains the
 * scheduled scans that never produced a signal in the first place. Only
 * `signal` and `no_setup` mean the strategy actually evaluated; every other
 * kind means the lane never got to decide.
 */

export const scanInstrumentKindSchema = z.enum([
  "signal",
  "no_setup",
  "insufficient_bars",
  "input_stale",
  "bars_failed",
  "evaluate_failed",
  "empty_universe",
]);

export type ScanInstrumentKind = z.infer<typeof scanInstrumentKindSchema>;

export const scanInstrumentOutcomeSchema = z.object({
  symbol: z.string(),
  kind: scanInstrumentKindSchema,
  barsActual: z.number().optional(),
  barsRequired: z.number().optional(),
  preferredContextBars: z.number().optional(),
  warmupBars: z.number().optional(),
  error: z.string().optional(),
  newestBarTs: z.string().optional(),
  barWindowHash: z.string().optional(),
});

export type ScanInstrumentOutcome = z.infer<typeof scanInstrumentOutcomeSchema>;

export const scanFunnelGroupSchema = z.object({
  groupKey: z.string(),
  /** True when the coordinator currently has a timer armed for this group. */
  armed: z.boolean(),
  running: z.boolean(),
  nextRunAt: z.string().nullable(),
  lastStartedAt: z.string().nullable(),
  lastFinishedAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  lastDurationMs: z.number().nullable(),
  consecutiveFailures: z.number(),
  lastError: z.string().nullable(),
  signalCount: z.number(),
  instrumentCount: z.number(),
  /** Outcome-kind histogram for the most recent scan. */
  counts: z.record(z.string(), z.number()),
  instruments: z.array(scanInstrumentOutcomeSchema),
  /** First instrument in the last scan that never reached a decision. */
  firstBlocked: scanInstrumentOutcomeSchema.nullable(),
  /** True when no instrument in the last scan reached a strategy decision. */
  allUnevaluable: z.boolean(),
});

export type ScanFunnelGroup = z.infer<typeof scanFunnelGroupSchema>;

export const scanFunnelReportSchema = z.object({
  sessionId: z.string(),
  groups: z.array(scanFunnelGroupSchema),
  /** Aggregate outcome-kind histogram across every group for this session. */
  counts: z.record(z.string(), z.number()),
  firstBlocked: scanInstrumentOutcomeSchema
    .extend({ groupKey: z.string() })
    .nullable(),
  /** True when the session has no scheduled scan groups at all. */
  noScheduledInputs: z.boolean(),
});

export type ScanFunnelReport = z.infer<typeof scanFunnelReportSchema>;

export const opportunityRateSummarySchema = z.object({
  sessionId: z.string(),
  day: z.string(),
  total: z.number(),
  /** Distinct symbol/bar-window pairs the strategy actually judged. */
  eligibleEvaluations: z.number(),
  /** Re-looks at a window already counted — not fresh chances. */
  repeatEvaluations: z.number(),
  setups: z.number(),
  setupRate: z.number(),
  blockedByHistory: z.number(),
  blockedByHistoryRate: z.number(),
  expectedSetupsPerDay: z.number(),
});

export type OpportunityRateSummary = z.infer<
  typeof opportunityRateSummarySchema
>;
