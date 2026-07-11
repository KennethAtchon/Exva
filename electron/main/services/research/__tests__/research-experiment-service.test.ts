import { describe, expect, it } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import { createMinimalSession } from "../../../db/test-fixtures";
import { SignalObservationsRepo } from "../../../db/repositories/research/signal-observations-repo";
import { SignalLabelsRepo } from "../../../db/repositories/research/signal-labels-repo";
import {
  BacktestRunsRepo,
  ModelVersionsRepo,
  PromotionDecisionsRepo,
} from "../../../db/repositories/research/experiment-repos";
import { SignalObservationService } from "../signal-observation-service";
import {
  hashResearchContract,
  ResearchExperimentService,
} from "../research-experiment-service";
import type { ExperienceResearchContract } from "@electron/shared/domain";

const CONTRACT: ExperienceResearchContract = {
  hypothesis: "h",
  tradableUniverse: ["X"],
  instrumentClass: "stock",
  signalTimestamp: "intraday",
  label: { horizon: "1d", outcome: "net_return", benchmark: "SPY" },
  validation: {
    minOutOfSampleTrades: 10,
    minNetExpectancyUsd: 0,
    minLowerBoundSharpe: 0,
    maxDrawdownPct: 0.9,
    requiredFolds: 2,
  },
  costs: { spreadBps: 1, slippageBps: 1, commissionBps: 0 },
};

function setup() {
  const db = createTestDb();
  const session = createMinimalSession(db);
  const obsRepo = new SignalObservationsRepo(db);
  const labelsRepo = new SignalLabelsRepo(db);
  const obsService = new SignalObservationService(obsRepo);
  const service = new ResearchExperimentService({
    observations: obsRepo,
    labels: labelsRepo,
    modelVersions: new ModelVersionsRepo(db),
    backtestRuns: new BacktestRunsRepo(db),
    promotionDecisions: new PromotionDecisionsRepo(db),
  });
  return { db, session, obsRepo, labelsRepo, obsService, service };
}

function seedLabeled(
  obsService: SignalObservationService,
  labelsRepo: SignalLabelsRepo,
  sessionId: string,
  netBpsList: number[],
) {
  netBpsList.forEach((netBps, i) => {
    const obs = obsService.record({
      sessionId,
      experienceId: "rules-mean-reversion",
      signalId: "sig",
      cycleId: `c-${i}`,
      instrumentSymbol: "SPY",
      instrumentClass: "stock",
      action: "buy",
      eventTime: new Date(2026, 0, i + 1).toISOString(),
      features: {},
      contract: CONTRACT,
    });
    labelsRepo.upsert({
      observationId: obs.id,
      horizon: "1d",
      benchmark: "SPY",
      grossReturnBps: netBps + 2,
      costBps: 2,
      netReturnBps: netBps,
      benchmarkReturnBps: 0,
      maxFavorableBps: Math.max(0, netBps),
      maxAdverseBps: Math.min(0, netBps),
      outcomeWin: netBps > 0 ? 1 : 0,
      labelReadyAt: new Date(2026, 0, i + 2).toISOString(),
      createdAt: new Date(2026, 0, i + 2).toISOString(),
    });
  });
}

describe("ResearchExperimentService", () => {
  it("contract hash is stable and order-independent", () => {
    const a = hashResearchContract(CONTRACT);
    const b = hashResearchContract({ ...CONTRACT });
    expect(a).toBe(b);
  });

  it("backtest verdict is inconclusive below min sample, fail on noise", () => {
    const { obsService, labelsRepo, service, session } = setup();
    seedLabeled(obsService, labelsRepo, session.id, [50, -50, 40]);
    const run = service.runBacktest({
      experienceId: "rules-mean-reversion",
      contract: CONTRACT,
    });
    expect(run.verdict).toBe("inconclusive"); // only 3 < 10 min

    const {
      obsService: o2,
      labelsRepo: l2,
      service: s2,
      session: sess2,
    } = setup();
    seedLabeled(
      o2,
      l2,
      sess2.id,
      Array.from({ length: 20 }, (_, i) => (i % 2 ? 80 : -80)),
    );
    const run2 = s2.runBacktest({
      experienceId: "rules-mean-reversion",
      contract: CONTRACT,
    });
    expect(run2.verdict).toBe("fail"); // coin-flip noise
  });

  it("promotes only one tier up when the gate passes, and records the decision", () => {
    const { obsService, labelsRepo, service, session } = setup();
    seedLabeled(
      obsService,
      labelsRepo,
      session.id,
      Array.from({ length: 40 }, (_, i) => 30 + (i % 3)),
    );

    expect(service.currentTier("rules-mean-reversion")).toBe("research");
    const decision = service.attemptPromotion({
      experienceId: "rules-mean-reversion",
      contract: CONTRACT,
      toTier: "backtest",
    });
    expect(decision.decision).toBe("approved");
    expect(service.currentTier("rules-mean-reversion")).toBe("backtest");

    // Cannot skip tiers: research -> live is rejected even with good evidence.
    const skip = service.attemptPromotion({
      experienceId: "rules-mean-reversion",
      contract: CONTRACT,
      toTier: "live",
    });
    expect(skip.decision).toBe("rejected");
  });

  it("drift check flags a recently-decayed edge", () => {
    const { obsService, labelsRepo, service, session } = setup();
    // Early good, recent bad.
    seedLabeled(obsService, labelsRepo, session.id, [
      ...Array.from({ length: 15 }, () => 40),
      ...Array.from({ length: 15 }, () => -60),
    ]);
    const drift = service.checkDrift({
      experienceId: "rules-mean-reversion",
      contract: CONTRACT,
      recentWindow: 15,
    });
    expect(drift.shouldKill).toBe(true);
    expect(drift.reasons).toContain("recent_sharpe_lower_nonpositive");
  });
});
