import { describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import { insertBrokerAccount } from "../../../db/test-fixtures";
import { ApiCallLogRepo } from "../../../db/repositories/system/api-call-log-repo";
import { BrokerAccountsRepo } from "../../../db/repositories/brokers/broker-accounts-repo";
import { BrokerRegistry } from "../broker-registry";

describe("BrokerRegistry instrumentation", () => {
  it("logs broker adapter calls when apiCallLogRepo is configured", async () => {
    const db = createTestDb();
    insertBrokerAccount(db, { id: "mock-1" });
    const secrets = { get: vi.fn().mockResolvedValue("{}") };
    const apiCallLogRepo = new ApiCallLogRepo(db);
    const registry = new BrokerRegistry(
      new BrokerAccountsRepo(db),
      secrets as never,
      apiCallLogRepo,
    );

    const adapter = await registry.get("mock-1");
    await adapter.getAccountBalance();

    const calls = apiCallLogRepo.listByScope({ sessionId: "missing" });
    expect(calls).toHaveLength(0);

    const rows = db.sqlite
      .prepare("select call_type, provider, endpoint, status from api_call_log")
      .all() as Array<{
      call_type: string;
      provider: string;
      endpoint: string;
      status: string;
    }>;
    expect(rows).toEqual([
      {
        call_type: "getAccountBalance",
        provider: "mock",
        endpoint: "mock-1/balance",
        status: "ok",
      },
    ]);

    db.sqlite.close();
  });
});
