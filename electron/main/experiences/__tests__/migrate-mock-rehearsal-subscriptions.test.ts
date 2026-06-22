import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMinimalSession,
  insertBrokerAccount,
} from "../../db/test-fixtures";
import { createTestDb } from "../../db/test-helpers";
import { SessionBrokerAssignmentsRepo } from "../../db/repositories/sessions/session-broker-assignments-repo";
import { SessionRepo } from "../../db/repositories/sessions/session-repo";
import { SignalSourcesRepo } from "../../services/signals/repos/signal-sources-repo";
import { ensureExperienceSignalSources } from "../ensure-experience-signal-sources";
import { ensureMockRehearsalSignalSource } from "../ensure-mock-rehearsal-signal-source";
import { migrateEligibleSessionsToMockRehearsal } from "../migrate-mock-rehearsal-subscriptions";
import { MOCK_REHEARSAL_SIGNAL_SOURCE_ID } from "@electron/shared/instruments/mock-rehearsal";
import { signalSourceId } from "@electron/shared/instruments/session-input-model";
import { EDGAR_CATALYST_EXPERIENCE } from "../edgar-catalyst/descriptor";
import { RULES_MEAN_REVERSION_EXPERIENCE } from "../rules-mean-reversion/descriptor";

describe("migrateEligibleSessionsToMockRehearsal", () => {
  let db = createTestDb();

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.sqlite.close();
  });

  it("migrates mock-only EDGAR sessions off the default experience sources", () => {
    const sessions = new SessionRepo(db);
    const assignments = new SessionBrokerAssignmentsRepo(db);
    const signalSources = new SignalSourcesRepo(db);
    ensureMockRehearsalSignalSource(signalSources, "NVDA");
    const sources = ensureExperienceSignalSources(
      signalSources,
      "edgar-catalyst",
    );

    const session = createMinimalSession(db, {
      experienceId: "edgar-catalyst",
      instrumentClasses: ["stock"],
    });
    insertBrokerAccount(db, {
      id: "mock-broker",
      brokerType: "mock",
      mockScenarioKind: "failed_breakout",
    });
    assignments.replaceAssignments(session.id, [
      { brokerAccountId: "mock-broker", allocatedUsd: 1000 },
    ]);
    // Subscribe to all experience-owned signal sources (the new model)
    signalSources.replaceSessionSubscriptions(
      session.id,
      sources.map((s) => s.id),
    );

    let syncedTicker = "";
    const migrated = migrateEligibleSessionsToMockRehearsal({
      sessions: sessions.list(),
      listAssignments: (sessionId) => assignments.listAssignments(sessionId),
      brokerAccounts: [
        {
          id: "mock-broker",
          brokerType: "mock",
          mockScenarioKind: "failed_breakout",
        },
      ],
      signalSources,
      syncTicker: (ticker) => {
        syncedTicker = ticker;
        ensureMockRehearsalSignalSource(signalSources, ticker);
      },
    });

    expect(migrated).toEqual([session.id]);
    expect(syncedTicker).toBe("AAPL");
    expect(signalSources.subscribedSourceIdsForSession(session.id)).toEqual([
      MOCK_REHEARSAL_SIGNAL_SOURCE_ID,
    ]);
  });

  it("edgar-catalyst signal source id is stable across re-provisioning", () => {
    const repo = new SignalSourcesRepo(db);
    const first = ensureExperienceSignalSources(repo, "edgar-catalyst");
    const second = ensureExperienceSignalSources(repo, "edgar-catalyst");
    expect(first.map((s) => s.id)).toEqual(second.map((s) => s.id));
    const expectedId = signalSourceId(
      "edgar-catalyst",
      EDGAR_CATALYST_EXPERIENCE.signals[0]?.id ?? "",
    );
    expect(first[0]?.id).toBe(expectedId);
  });

  it("repairs existing timer signal source config from descriptors", () => {
    const repo = new SignalSourcesRepo(db);
    const signal = RULES_MEAN_REVERSION_EXPERIENCE.signals[0];
    if (!signal) throw new Error("Expected mean-reversion signal");
    const sourceId = signalSourceId(
      RULES_MEAN_REVERSION_EXPERIENCE.id,
      signal.id,
    );
    repo.create({
      id: sourceId,
      type: signal.sourceType,
      name: "Stale timer source",
      description: null,
      enabled: false,
      experienceId: RULES_MEAN_REVERSION_EXPERIENCE.id,
      instrumentClass: null,
      pollCadence: null,
      analysisTimeframe: null,
      pipelineId: null,
      configJson: JSON.stringify({
        signalId: signal.id,
        symbol: signal.symbol,
      }),
    });

    const [repaired] = ensureExperienceSignalSources(
      repo,
      RULES_MEAN_REVERSION_EXPERIENCE.id,
    );

    expect(repaired?.enabled).toBe(false);
    expect(repaired?.pollCadence).toBe(signal.pollCadence);
    expect(JSON.parse(repaired?.configJson ?? "{}")).toMatchObject({
      signalId: signal.id,
      symbol: signal.symbol,
      cadence: signal.pollCadence,
      pollCadence: signal.pollCadence,
      analysisTimeframe: signal.defaultAnalysisTimeframe,
      instrumentClass: signal.instrumentClass,
    });
  });
});
