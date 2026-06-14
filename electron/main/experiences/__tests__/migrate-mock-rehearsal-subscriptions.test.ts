import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMinimalSession,
  insertBrokerAccount,
} from "../../db/test-fixtures";
import { createTestDb } from "../../db/test-helpers";
import { SessionBrokerAssignmentsRepo } from "../../db/repositories/sessions/session-broker-assignments-repo";
import { SessionRepo } from "../../db/repositories/sessions/session-repo";
import { SignalSourcesRepo } from "../../services/signals/repos/signal-sources-repo";
import { ensureExperienceSignalSource } from "../ensure-experience-signal-sources";
import { ensureMockRehearsalSignalSource } from "../ensure-mock-rehearsal-signal-source";
import { migrateEligibleSessionsToMockRehearsal } from "../migrate-mock-rehearsal-subscriptions";
import { MOCK_REHEARSAL_SIGNAL_SOURCE_ID } from "@electron/shared/instruments/mock-rehearsal";
import { experienceSignalSourceId } from "@electron/shared/instruments/session-input-model";

describe("migrateEligibleSessionsToMockRehearsal", () => {
  let db = createTestDb();

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.sqlite.close();
  });

  it("migrates mock-only EDGAR sessions off the default experience source", () => {
    const sessions = new SessionRepo(db);
    const assignments = new SessionBrokerAssignmentsRepo(db);
    const signalSources = new SignalSourcesRepo(db);
    ensureMockRehearsalSignalSource(signalSources, "NVDA");
    ensureExperienceSignalSource(signalSources, "edgar-catalyst");

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
    signalSources.replaceSessionSubscriptions(session.id, [
      experienceSignalSourceId("edgar-catalyst"),
    ]);

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
});
