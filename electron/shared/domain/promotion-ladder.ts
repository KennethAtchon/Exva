import type { ExecutionMode } from "./enums";
import type { MockExecutionTier } from "./mock-scenario";

/** Hard promotion ladder per experience: scripted → rehearsal → paper → live. */
export const PROMOTION_TIERS = [
  "scripted",
  "rehearsal",
  "paper",
  "live",
] as const;

export type PromotionTier = (typeof PROMOTION_TIERS)[number];

/** Research evidence rungs: backtest → paper → live_small → live_scaled. */
export const EVIDENCE_RUNGS = [
  "backtest",
  "paper",
  "live_small",
  "live_scaled",
] as const;

export type EvidenceRung = (typeof EVIDENCE_RUNGS)[number];

export function resolveSessionPromotionTier(input: {
  executionMode: ExecutionMode;
  usesMockBroker: boolean;
  mockExecutionTier?: MockExecutionTier | null;
}): PromotionTier {
  if (input.executionMode === "live_allowed") return "live";
  if (input.usesMockBroker) {
    return input.mockExecutionTier === "rehearsal" ? "rehearsal" : "scripted";
  }
  return "paper";
}

export function nextPromotionTier(
  current: PromotionTier,
): PromotionTier | null {
  const idx = PROMOTION_TIERS.indexOf(current);
  if (idx < 0 || idx >= PROMOTION_TIERS.length - 1) return null;
  return PROMOTION_TIERS[idx + 1] ?? null;
}

export function nextEvidenceRung(current: EvidenceRung): EvidenceRung | null {
  const idx = EVIDENCE_RUNGS.indexOf(current);
  if (idx < 0 || idx >= EVIDENCE_RUNGS.length - 1) return null;
  return EVIDENCE_RUNGS[idx + 1] ?? null;
}

/** True when `to` is exactly one rung above `from` (no skipping). */
export function canTransitionEvidenceRung(
  from: EvidenceRung,
  to: EvidenceRung,
): boolean {
  return nextEvidenceRung(from) === to;
}

export function evidenceRungIndex(rung: EvidenceRung): number {
  return EVIDENCE_RUNGS.indexOf(rung);
}
