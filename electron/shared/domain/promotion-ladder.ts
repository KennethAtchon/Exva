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

export const PROMOTION_TIER_LABELS: Record<
  PromotionTier,
  { label: string; description: string }
> = {
  scripted: {
    label: "Scripted",
    description: "Canned worker outputs on mock fixtures — deterministic E2E",
  },
  rehearsal: {
    label: "Rehearsal",
    description: "Real LLM on mock fixtures — prompt and judgment QA",
  },
  paper: {
    label: "Paper (real quotes)",
    description: "Real LLM and real market data — edge validation",
  },
  live: {
    label: "Live",
    description: "Production execution with live broker connectivity",
  },
};

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
