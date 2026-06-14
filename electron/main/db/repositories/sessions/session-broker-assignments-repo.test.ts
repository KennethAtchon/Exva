import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import { createMinimalSession, insertBrokerAccount } from "../../test-fixtures";
import { SessionBrokerAssignmentsRepo } from "./session-broker-assignments-repo";

describe("SessionBrokerAssignmentsRepo", () => {
  it("replaces and queries broker assignments", () => {
    const db = createTestDb();
    const repo = new SessionBrokerAssignmentsRepo(db);
    const session = createMinimalSession(db);
    const brokerA = insertBrokerAccount(db, { id: "broker-a" });
    const brokerB = insertBrokerAccount(db, { id: "broker-b" });

    repo.replaceAssignments(session.id, [
      { brokerAccountId: brokerA.id, allocatedUsd: 1000 },
      { brokerAccountId: brokerB.id, allocatedUsd: 500 },
    ]);

    expect(repo.listBrokerAccountIds(session.id)).toEqual([
      brokerA.id,
      brokerB.id,
    ]);
    expect(repo.listAssignments(session.id)).toMatchObject([
      { brokerAccountId: brokerA.id, allocatedUsd: 1000 },
      { brokerAccountId: brokerB.id, allocatedUsd: 500 },
    ]);
    expect(repo.countBySession(session.id)).toBe(2);
    expect(repo.sumAllocatedUsdForBroker(brokerA.id, [session.id])).toBe(1000);

    repo.setAllocatedUsd(session.id, brokerA.id, 750);
    expect(repo.findAssignment(session.id, brokerA.id)?.allocatedUsd).toBe(750);

    db.sqlite.close();
  });
});
