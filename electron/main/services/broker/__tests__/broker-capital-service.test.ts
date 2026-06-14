import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import {
  createMinimalSession,
  insertBrokerAccount,
} from "../../../db/test-fixtures";
import { BrokerAccountsRepo } from "../../../db/repositories/brokers/broker-accounts-repo";
import { SessionBrokerAssignmentsRepo } from "../../../db/repositories/sessions/session-broker-assignments-repo";
import { SessionRepo } from "../../../db/repositories/sessions/session-repo";
import { BrokerCapitalService } from "../broker-capital-service";

describe("BrokerCapitalService", () => {
  let db = createTestDb();

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.sqlite.close();
  });

  it("computes free capital and active session allocations", () => {
    insertBrokerAccount(db, { id: "broker-1" });
    const brokers = new BrokerAccountsRepo(db);
    brokers.updateBalanceCache("broker-1", 10_000, new Date().toISOString());
    const active = createMinimalSession(db, { name: "Active Session" });
    const draft = createMinimalSession(db, { name: "Draft Session" });
    const sessions = new SessionRepo(db);
    sessions.setStatus("active", active.id);
    new SessionBrokerAssignmentsRepo(db).replaceAssignments(active.id, [
      { brokerAccountId: "broker-1", allocatedUsd: 3000 },
    ]);
    new SessionBrokerAssignmentsRepo(db).replaceAssignments(draft.id, [
      { brokerAccountId: "broker-1", allocatedUsd: 5000 },
    ]);

    const service = createService(db);
    const [state] = service.listWithState();

    expect(state?.totalAllocatedUsd).toBe(3000);
    expect(state?.freeCapitalUsd).toBe(7000);
    expect(state?.activeSessionCount).toBe(1);
    expect(state?.sessions).toEqual([
      expect.objectContaining({
        sessionId: active.id,
        allocatedUsd: 3000,
        status: "active",
      }),
    ]);
  });

  it("flags over-allocation when a session start would exceed free capital", () => {
    insertBrokerAccount(db, { id: "broker-1" });
    new BrokerAccountsRepo(db).updateBalanceCache(
      "broker-1",
      5000,
      new Date().toISOString(),
    );
    const other = createMinimalSession(db, { name: "Other Active" });
    const starting = createMinimalSession(db, { name: "Starting" });
    const sessions = new SessionRepo(db);
    sessions.setStatus("active", other.id);
    const assignments = new SessionBrokerAssignmentsRepo(db);
    assignments.replaceAssignments(other.id, [
      { brokerAccountId: "broker-1", allocatedUsd: 4000 },
    ]);
    assignments.replaceAssignments(starting.id, [
      { brokerAccountId: "broker-1", allocatedUsd: 2000 },
    ]);

    const result = createService(db).checkSessionStartFits(starting.id);

    expect(result).toEqual({
      ok: false,
      failures: [
        expect.objectContaining({
          brokerAccountId: "broker-1",
          reason: "over_allocated",
        }),
      ],
    });
  });

  it("flags session cap violations before start", () => {
    insertBrokerAccount(db, { id: "broker-1" });
    new BrokerAccountsRepo(db).updateSettings("broker-1", { maxSessions: 1 });
    const first = createMinimalSession(db, { name: "First Active" });
    const second = createMinimalSession(db, { name: "Second Start" });
    const sessions = new SessionRepo(db);
    sessions.setStatus("active", first.id);
    const assignments = new SessionBrokerAssignmentsRepo(db);
    assignments.replaceAssignments(first.id, [
      { brokerAccountId: "broker-1", allocatedUsd: 1000 },
    ]);
    assignments.replaceAssignments(second.id, [
      { brokerAccountId: "broker-1", allocatedUsd: 1000 },
    ]);

    const result = createService(db).checkSessionStartFits(second.id);

    expect(result).toEqual({
      ok: false,
      failures: [
        expect.objectContaining({
          brokerAccountId: "broker-1",
          reason: "session_cap_exceeded",
        }),
      ],
    });
  });

  it("rejects lowering maxSessions below active session count", () => {
    insertBrokerAccount(db, { id: "broker-1" });
    const brokers = new BrokerAccountsRepo(db);
    brokers.updateSettings("broker-1", { maxSessions: 2 });
    const first = createMinimalSession(db, { name: "First Active" });
    const second = createMinimalSession(db, { name: "Second Active" });
    const sessions = new SessionRepo(db);
    sessions.setStatus("active", first.id);
    sessions.setStatus("active", second.id);
    const assignments = new SessionBrokerAssignmentsRepo(db);
    assignments.replaceAssignments(first.id, [
      { brokerAccountId: "broker-1", allocatedUsd: 1000 },
    ]);
    assignments.replaceAssignments(second.id, [
      { brokerAccountId: "broker-1", allocatedUsd: 1000 },
    ]);

    expect(() =>
      createService(db).updateSettings("broker-1", { maxSessions: 0 }),
    ).toThrow(/between 1 and 50/i);
    expect(() =>
      createService(db).updateSettings("broker-1", { maxSessions: 1 }),
    ).toThrow(/active sessions/i);
  });
});

function createService(db: ReturnType<typeof createTestDb>) {
  return new BrokerCapitalService(
    new BrokerAccountsRepo(db),
    new SessionBrokerAssignmentsRepo(db),
    new SessionRepo(db),
  );
}
