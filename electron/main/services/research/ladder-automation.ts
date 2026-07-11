import type { EvidenceRung } from "@electron/shared/domain/promotion-ladder";
import {
  canTransitionEvidenceRung,
  evidenceRungIndex,
  nextEvidenceRung,
} from "@electron/shared/domain/promotion-ladder";
import type { PromotionDecisionResult } from "./promotion-gate";

/**
 * Hands-free promotion ladder automation (§9.9).
 * Upgrades require one approval tap; downgrades are automatic.
 */

export interface LadderState {
  experienceId: string;
  rung: EvidenceRung;
  /** Capital bound for this rung (USD). */
  capitalBoundUsd: number;
  lastEvaluatedAt: string;
  pendingUpgradeTo: EvidenceRung | null;
}

export interface LadderAutomationDeps {
  getState(experienceId: string): LadderState | null;
  setState(state: LadderState): void;
  /** Latest promotion gate evaluation for the experience. */
  evaluateEligibility(experienceId: string): PromotionDecisionResult;
  notify(title: string, body: string): void;
}

const DEFAULT_BOUNDS: Record<EvidenceRung, number> = {
  backtest: 0,
  paper: 5_000,
  live_small: 2_500,
  live_scaled: 25_000,
};

export function defaultLadderState(experienceId: string): LadderState {
  return {
    experienceId,
    rung: "paper",
    capitalBoundUsd: DEFAULT_BOUNDS.paper,
    lastEvaluatedAt: new Date().toISOString(),
    pendingUpgradeTo: null,
  };
}

/**
 * Continuous eligibility check. Eligible upgrades set pendingUpgradeTo
 * (needs operator tap). Failed live evidence demotes automatically.
 */
export function tickLadderAutomation(
  deps: LadderAutomationDeps,
  experienceId: string,
): LadderState {
  const current =
    deps.getState(experienceId) ?? defaultLadderState(experienceId);
  const decision = deps.evaluateEligibility(experienceId);
  const now = new Date().toISOString();

  if (decision.promote) {
    const next = nextEvidenceRung(current.rung);
    if (next && canTransitionEvidenceRung(current.rung, next)) {
      const pending: LadderState = {
        ...current,
        lastEvaluatedAt: now,
        pendingUpgradeTo: next,
      };
      deps.setState(pending);
      deps.notify(
        "Exva: promotion ready",
        `${experienceId} eligible for ${next}. Approve to raise capital bound.`,
      );
      return pending;
    }
  }

  // Auto-demote from live_* when evidence collapses.
  if (
    !decision.promote &&
    (current.rung === "live_small" || current.rung === "live_scaled")
  ) {
    const demoted: LadderState = {
      experienceId,
      rung: "paper",
      capitalBoundUsd: DEFAULT_BOUNDS.paper,
      lastEvaluatedAt: now,
      pendingUpgradeTo: null,
    };
    deps.setState(demoted);
    deps.notify(
      "Exva: ladder demotion",
      `${experienceId} demoted to paper — promotion gate failed.`,
    );
    return demoted;
  }

  const refreshed = { ...current, lastEvaluatedAt: now };
  deps.setState(refreshed);
  return refreshed;
}

/** Operator taps to accept a pending upgrade. */
export function approveLadderUpgrade(
  deps: LadderAutomationDeps,
  experienceId: string,
): LadderState | null {
  const current = deps.getState(experienceId);
  if (!current?.pendingUpgradeTo) return null;
  const next = current.pendingUpgradeTo;
  if (evidenceRungIndex(next) <= evidenceRungIndex(current.rung)) return null;
  const upgraded: LadderState = {
    experienceId,
    rung: next,
    capitalBoundUsd: DEFAULT_BOUNDS[next],
    lastEvaluatedAt: new Date().toISOString(),
    pendingUpgradeTo: null,
  };
  deps.setState(upgraded);
  deps.notify(
    "Exva: promotion applied",
    `${experienceId} now on ${next} (bound $${DEFAULT_BOUNDS[next]}).`,
  );
  return upgraded;
}
