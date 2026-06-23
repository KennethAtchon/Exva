import { describe, expect, it } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import { createMinimalSession } from "../../../db/test-fixtures";
import { SignalObservationsRepo } from "../../../db/repositories/research/signal-observations-repo";
import { SignalLabelsRepo } from "../../../db/repositories/research/signal-labels-repo";
import { SignalObservationService } from "../signal-observation-service";
import { LabelBuilderService } from "../label-builder-service";
import { createLogger } from "../../infra/log";
import type { ExperienceResearchContract } from "@electron/shared/domain";

const CONTRACT: ExperienceResearchContract = {
  hypothesis: "h",
  tradableUniverse: ["SPY"],
  instrumentClass: "stock",
  signalTimestamp: "intraday",
  label: { horizon: "1h", outcome: "net_return", benchmark: "SPY" },
  validation: {
    minOutOfSampleTrades: 1,
    minNetExpectancyUsd: 0,
    minLowerBoundSharpe: 0,
    maxDrawdownPct: 1,
    requiredFolds: 1,
  },
  costs: { spreadBps: 1, slippageBps: 1, commissionBps: 0 },
};

describe("SignalObservationService + LabelBuilderService", () => {
  it("records skipped observations and computes a labelReadyAt", () => {
    const db = createTestDb();
    const session = createMinimalSession(db);
    const repo = new SignalObservationsRepo(db);
    const service = new SignalObservationService(repo);

    const obs = service.record({
      sessionId: session.id,
      experienceId: "rules-mean-reversion",
      signalId: "spy-15m",
      cycleId: "cycle-1",
      instrumentSymbol: "SPY",
      instrumentClass: "stock",
      action: "skip",
      eventTime: "2026-06-22T10:00:00.000Z",
      features: { z: -1.1 },
      reasoning: "z-score not extended enough",
      contract: CONTRACT,
    });

    expect(obs.action).toBe("skip");
    // 1h horizon -> ready one hour later
    expect(obs.labelReadyAt).toBe("2026-06-22T11:00:00.000Z");
    expect(repo.get(obs.id)?.featureJson).toContain("-1.1");
  });

  it("label builder labels due observations and is idempotent", async () => {
    const db = createTestDb();
    const session = createMinimalSession(db);
    const obsRepo = new SignalObservationsRepo(db);
    const labelsRepo = new SignalLabelsRepo(db);
    const obsService = new SignalObservationService(obsRepo);

    const obs = obsService.record({
      sessionId: session.id,
      experienceId: "rules-mean-reversion",
      signalId: "spy-15m",
      cycleId: "cycle-1",
      instrumentSymbol: "SPY",
      instrumentClass: "stock",
      action: "buy",
      eventTime: "2026-06-22T10:00:00.000Z",
      features: {},
      referencePrice: 100,
      contract: CONTRACT,
    });

    const builder = new LabelBuilderService({
      observations: obsRepo,
      labels: labelsRepo,
      logger: createLogger("test-label-builder"),
    });

    const resolver = async () => ({
      grossReturnBps: 50,
      costBps: 2,
      benchmarkReturnBps: 10,
      maxFavorableBps: 60,
      maxAdverseBps: -5,
      outcomeWin: 1,
    });

    const after = "2026-06-23T00:00:00.000Z";
    const first = await builder.runDue(resolver, after);
    expect(first.labeled).toBe(1);

    const label = labelsRepo.get(obs.id, "1h", "SPY");
    expect(label?.netReturnBps).toBe(48); // 50 - 2

    // Idempotent: second run does not relabel.
    const second = await builder.runDue(resolver, after);
    expect(second.labeled).toBe(0);
    expect(second.skipped).toBe(1);
  });
});
