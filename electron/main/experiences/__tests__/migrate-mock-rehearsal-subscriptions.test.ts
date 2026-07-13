import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMinimalSession,
  insertBrokerAccount,
} from "../../db/test-fixtures";
import { createTestDb } from "../../db/test-helpers";
import { SessionBrokerAssignmentsRepo } from "../../db/repositories/sessions/session-broker-assignments-repo";
import { SessionRepo } from "../../db/repositories/sessions/session-repo";
import { migrateEligibleSessionsToMockRehearsal } from "../migrate-mock-rehearsal-subscriptions";

describe("migrateEligibleSessionsToMockRehearsal", () => {
  let db = createTestDb();

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.sqlite.close();
  });

  it("is a no-op stub returning [] (V2: subscriptions managed by catalog)", () => {
    const sessions = new SessionRepo(db);
    const assignments = new SessionBrokerAssignmentsRepo(db);

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
      syncTicker: () => {},
    });

    expect(migrated).toEqual([]);
  });
});
