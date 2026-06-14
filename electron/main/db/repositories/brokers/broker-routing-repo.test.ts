import { describe, expect, it } from "vitest";
import { createTestDb } from "../../test-helpers";
import { createMinimalSession, insertBrokerAccount } from "../../test-fixtures";
import { BrokerRoutingRepo } from "./broker-routing-repo";

describe("BrokerRoutingRepo", () => {
  it("upserts global defaults and session overrides", () => {
    const db = createTestDb();
    const repo = new BrokerRoutingRepo(db);
    const broker = insertBrokerAccount(db, { id: "broker-stock" });
    const session = createMinimalSession(db);

    repo.upsertGlobalDefaults([
      { instrumentClass: "stock", defaultBrokerAccountId: broker.id },
    ]);
    expect(repo.listGlobalDefaults()).toMatchObject([
      { instrumentClass: "stock", defaultBrokerAccountId: broker.id },
    ]);
    expect(repo.resolveBrokerAccountId(session.id, "stock")).toBe(broker.id);

    repo.upsertSessionOverrides(session.id, [
      { instrumentClass: "crypto", brokerAccountId: broker.id },
    ]);
    expect(repo.listSessionOverrides(session.id)).toMatchObject([
      { instrumentClass: "crypto", brokerAccountId: broker.id },
    ]);
    expect(repo.resolveBrokerAccountId(session.id, "crypto")).toBe(broker.id);

    repo.upsertSessionOverrides(session.id, [
      { instrumentClass: "crypto", brokerAccountId: null },
    ]);
    expect(repo.listSessionOverrides(session.id)).toEqual([]);

    db.sqlite.close();
  });
});
