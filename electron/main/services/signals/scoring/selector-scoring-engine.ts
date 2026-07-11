import type { Candidate } from "@electron/shared/ai/selector-candidate";
import {
  DEFAULT_SCORING_WEIGHTS,
  type ScoringWeights,
} from "@electron/shared/ai/ai-phase-config";

export type { ScoringWeights } from "@electron/shared/ai/ai-phase-config";
export { DEFAULT_SCORING_WEIGHTS } from "@electron/shared/ai/ai-phase-config";

export function scoreCandidate(
  candidate: Candidate,
  weights: ScoringWeights,
): number {
  const totalWeight =
    weights.hype + weights.volume + weights.catalyst + weights.liquidity;
  if (totalWeight <= 0) return 0;
  return (
    (weights.hype * (candidate.hypeScore ?? 0) +
      weights.volume * (candidate.volumeScore ?? 0) +
      weights.catalyst * (candidate.catalystScore ?? 0) +
      weights.liquidity * (candidate.liquidityScore ?? 0)) /
    totalWeight
  );
}

export function scoreCandidates(
  candidates: Candidate[],
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
): Candidate[] {
  return candidates
    .map((candidate) => ({
      ...candidate,
      finalScore: scoreCandidate(candidate, weights),
    }))
    .sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));
}
