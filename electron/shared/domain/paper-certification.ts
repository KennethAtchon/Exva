import { z } from "zod";

export const paperCertificationStatusSchema = z.enum([
  "armed",
  "submitting_entry",
  "entry_open",
  "entry_filled",
  "submitting_exit",
  "exit_open",
  "closed",
  "failed",
  "reconciliation_required",
]);

export type PaperCertificationStatus = z.infer<
  typeof paperCertificationStatusSchema
>;

export const paperCertificationRunSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  brokerAccountId: z.string(),
  symbol: z.literal("SPY"),
  notionalUsd: z.literal(10),
  status: paperCertificationStatusSchema,
  entryClientOrderId: z.string(),
  entryBrokerOrderId: z.string().nullable(),
  exitClientOrderId: z.string().nullable(),
  exitBrokerOrderId: z.string().nullable(),
  filledQuantity: z.number(),
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
  armedAt: z.string(),
  completedAt: z.string().nullable(),
});

export type PaperCertificationRun = z.infer<typeof paperCertificationRunSchema>;

export const PAPER_CERTIFICATION_NOTIONAL_USD = 10 as const;
export const PAPER_CERTIFICATION_SYMBOL = "SPY" as const;
export const PAPER_CERTIFICATION_ARM_TTL_MS = 15 * 60_000;
