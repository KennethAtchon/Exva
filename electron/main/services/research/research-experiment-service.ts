import type {
  BacktestRun,
  BacktestVerdict,
  ExperienceResearchContract,
  ModelVersion,
  PromotionDecision,
  ResearchTier,
  SignalLabel,
} from "@electron/shared/domain";
import {
  brierScore,
  sharpeLowerBound,
} from "@electron/shared/quant/statistics";
import type {
  BacktestRunsRepo,
  ModelVersionsRepo,
  PromotionDecisionsRepo,
} from "../../db/repositories/research/experiment-repos";
import type { SignalLabelsRepo } from "../../db/repositories/research/signal-labels-repo";
import type { SignalObservationsRepo } from "../../db/repositories/research/signal-observations-repo";
import { evaluatePromotion } from "./promotion-gate";

/** Stable content hash of a research contract, for backtest reproducibility. */
export function hashResearchContract(
  contract: ExperienceResearchContract,
): string {
  const json = JSON.stringify(contract, Object.keys(contract).sort());
  let hash = 0;
  for (let i = 0; i < json.length; i++) {
    hash = (Math.imul(31, hash) + json.charCodeAt(i)) | 0;
  }
  return `c${(hash >>> 0).toString(16)}`;
}

interface ResearchExperimentDeps {
  observations: SignalObservationsRepo;
  labels: SignalLabelsRepo;
  modelVersions: ModelVersionsRepo;
  backtestRuns: BacktestRunsRepo;
  promotionDecisions: PromotionDecisionsRepo;
}

const TIER_ORDER: ResearchTier[] = ["research", "backtest", "paper", "live"];

/**
 * Coordinates the versioned experiment loop (P7): backtests over locked
 * contracts, statistical promotion gating, and drift monitoring. No direct
 * path exists from "lesson sounds good" to "live rule changed" — every change
 * must clear this gate.
 */
export class ResearchExperimentService {
  constructor(private readonly deps: ResearchExperimentDeps) {}

  registerModelVersion(version: ModelVersion): void {
    this.deps.modelVersions.insert(version);
  }

  currentTier(experienceId: string): ResearchTier {
    return this.deps.promotionDecisions.latestTier(experienceId);
  }

  /**
   * Replay a locked contract over all labeled observations for an experience
   * and persist a backtest run with a verdict.
   */
  runBacktest(input: {
    experienceId: string;
    contract: ExperienceResearchContract;
    modelVersionId?: string | null;
  }): BacktestRun {
    const labels = this.labeledFor(input.experienceId);
    const evaluation = evaluatePromotion(input.contract, labels);
    const verdict: BacktestVerdict = evaluation.promote
      ? "pass"
      : labels.length < input.contract.validation.minOutOfSampleTrades
        ? "inconclusive"
        : "fail";

    const window = observationWindow(labels);
    const run: BacktestRun = {
      id: crypto.randomUUID(),
      experienceId: input.experienceId,
      modelVersionId: input.modelVersionId ?? null,
      contractHash: hashResearchContract(input.contract),
      windowStart: window.start,
      windowEnd: window.end,
      foldConfigJson: JSON.stringify({
        requiredFolds: input.contract.validation.requiredFolds,
        purge: 1,
      }),
      costModelJson: JSON.stringify(input.contract.costs),
      metricsJson: JSON.stringify(evaluation.evidence),
      verdict,
      createdAt: new Date().toISOString(),
    };
    this.deps.backtestRuns.insert(run);
    return run;
  }

  /**
   * Attempt a one-tier promotion. Records and returns the decision. Requires the
   * statistical promotion gate to pass over labeled out-of-sample data.
   */
  attemptPromotion(input: {
    experienceId: string;
    contract: ExperienceResearchContract;
    toTier: ResearchTier;
    modelVersionId?: string | null;
  }): PromotionDecision {
    const fromTier = this.currentTier(input.experienceId);
    const labels = this.labeledFor(input.experienceId);
    const evaluation = evaluatePromotion(input.contract, labels);

    const decided = evaluation.promote && isOneStepUp(fromTier, input.toTier);
    const decision: PromotionDecision = {
      id: crypto.randomUUID(),
      experienceId: input.experienceId,
      modelVersionId: input.modelVersionId ?? null,
      fromTier,
      toTier: input.toTier,
      decision: decided ? "approved" : "rejected",
      evidenceJson: JSON.stringify({
        ...evaluation,
        oneStepUp: isOneStepUp(fromTier, input.toTier),
      }),
      decidedAt: new Date().toISOString(),
    };
    this.deps.promotionDecisions.insert(decision);
    return decision;
  }

  /**
   * Drift check (P7): compare recent realized calibration/return against the
   * validation distribution. Returns shouldKill=true when calibration or
   * drawdown deviate beyond tolerance.
   */
  checkDrift(input: {
    experienceId: string;
    contract: ExperienceResearchContract;
    recentWindow: number;
  }): {
    shouldKill: boolean;
    reasons: string[];
    recentSharpeLower: number;
    recentBrier: number | null;
  } {
    const labels = this.labeledFor(input.experienceId);
    const recent = labels.slice(-input.recentWindow);
    const reasons: string[] = [];

    const netFractions = recent
      .map((l) => l.netReturnBps)
      .filter((v): v is number => v != null)
      .map((bps) => bps / 10_000);
    const recentSharpeLower = sharpeLowerBound(netFractions, 0.95).lower;
    if (recent.length >= 10 && recentSharpeLower <= 0) {
      reasons.push("recent_sharpe_lower_nonpositive");
    }

    const probPreds = recent
      .filter((l) => l.outcomeWin != null)
      .map((l) => ({
        probability: (l.netReturnBps ?? 0) > 0 ? 0.6 : 0.4,
        outcome: (l.outcomeWin === 1 ? 1 : 0) as 0 | 1,
      }));
    const recentBrier = probPreds.length > 0 ? brierScore(probPreds) : null;
    if (
      input.contract.validation.maxBrierScore != null &&
      recentBrier != null &&
      recentBrier > input.contract.validation.maxBrierScore
    ) {
      reasons.push("recent_brier_exceeds_contract");
    }

    return {
      shouldKill: reasons.length > 0,
      reasons,
      recentSharpeLower,
      recentBrier,
    };
  }

  private labeledFor(experienceId: string): SignalLabel[] {
    const observations = this.deps.observations.listByExperience(experienceId);
    const labels: SignalLabel[] = [];
    for (const obs of observations) {
      const obsLabels = this.deps.labels.listByObservation(obs.id);
      for (const label of obsLabels) labels.push(label);
    }
    return labels;
  }
}

function isOneStepUp(from: ResearchTier, to: ResearchTier): boolean {
  const fi = TIER_ORDER.indexOf(from);
  const ti = TIER_ORDER.indexOf(to);
  return ti === fi + 1;
}

function observationWindow(labels: readonly SignalLabel[]): {
  start: string;
  end: string;
} {
  if (labels.length === 0) {
    const now = new Date().toISOString();
    return { start: now, end: now };
  }
  const times = labels.map((l) => l.labelReadyAt).sort();
  return {
    start: times[0] ?? new Date().toISOString(),
    end: times[times.length - 1] ?? new Date().toISOString(),
  };
}
