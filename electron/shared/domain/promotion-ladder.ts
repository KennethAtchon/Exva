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
