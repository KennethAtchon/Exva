import { z } from "zod";
import { signalOriginKindSchema } from "./deterministic-signal-fact";

export const cycleFunnelTerminalStageSchema = z.enum([
  "input",
  "signal",
  "delivery",
  "selector",
  "research",
  "decision",
  "risk",
  "approval",
  "order",
  "fill",
]);

export const cycleFunnelOutcomeKindSchema = z.enum([
  "advanced",
  "no_setup",
  "rejected",
  "failed",
  "expired",
  "filled",
  "input_stale",
  "input_insufficient_history",
]);

export const cycleFunnelOutcomeSchema = z.object({
  cycleId: z.string(),
  sessionId: z.string(),
  inputId: z.string().nullable(),
  originKind: signalOriginKindSchema,
  terminalStage: cycleFunnelTerminalStageSchema,
  outcome: cycleFunnelOutcomeKindSchema,
  reasonCode: z.string(),
  detailJson: z.string(),
  occurredAt: z.string(),
});

export type CycleFunnelOutcome = z.infer<typeof cycleFunnelOutcomeSchema>;

/** Stable reason codes for first-divergence headlines (Solution 05). */
export const FUNNEL_REASON_CODES = {
  INPUT_STALE: "INPUT_STALE",
  INPUT_INSUFFICIENT_HISTORY: "INPUT_INSUFFICIENT_HISTORY",
  NO_SETUP: "NO_SETUP",
  MARKET_CLOSED: "MARKET_CLOSED",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  MODEL_OUTPUT_INVALID: "MODEL_OUTPUT_INVALID",
  RISK_REJECTED: "RISK_REJECTED",
  APPROVAL_REJECTED: "APPROVAL_REJECTED",
  ORDER_REJECTED: "ORDER_REJECTED",
  FILLED: "FILLED",
} as const;
