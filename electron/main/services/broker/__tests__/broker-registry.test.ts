import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import { insertBrokerAccount } from "../../../db/test-fixtures";
import { BrokerAccountsRepo } from "../../../db/repositories/brokers/broker-accounts-repo";
import { BrokerRegistry } from "../broker-registry";
import { MockBrokerAdapter } from "../adapters/mock-adapter";
import { AlpacaAdapter } from "../adapters/alpaca-adapter";

describe("BrokerRegistry", () => {
  let db = createTestDb();
  const secrets = { get: vi.fn() };

  beforeEach(() => {
    db = createTestDb();
    secrets.get.mockReset();
  });

  afterEach(() => {
    db.sqlite.close();
  });

  it("caches adapters per broker account id", async () => {
    insertBrokerAccount(db, { id: "mock-1" });
    secrets.get.mockResolvedValue("{}");
    const registry = new BrokerRegistry(
      new BrokerAccountsRepo(db),
      secrets as never,
    );

    const first = await registry.get("mock-1");
    const second = await registry.get("mock-1");

    expect(first).toBe(second);
    expect(secrets.get).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the adapter after invalidation", async () => {
    insertBrokerAccount(db, { id: "mock-1" });
    secrets.get.mockResolvedValue("{}");
    const registry = new BrokerRegistry(
      new BrokerAccountsRepo(db),
      secrets as never,
    );

    const first = await registry.get("mock-1");
    registry.invalidate("mock-1");
    const second = await registry.get("mock-1");

    expect(second).not.toBe(first);
    expect(second).toBeInstanceOf(MockBrokerAdapter);
  });

  it("buildEphemeral does not populate the cache", async () => {
    const repo = new BrokerAccountsRepo(db);
    insertBrokerAccount(db, {
      id: "mock-1",
      mockScenarioKind: "failed_breakout",
    });
    const account = repo.require("mock-1");
    const registry = new BrokerRegistry(repo, secrets as never);

    const ephemeral = await registry.buildEphemeral(account, "{}");
    const cached = await registry.get("mock-1");

    expect(ephemeral).not.toBe(cached);
    expect((ephemeral as MockBrokerAdapter).getScenarioKind()).toBe(
      "failed_breakout",
    );
  });

  it("builds an Alpaca adapter from stored credentials", async () => {
    insertBrokerAccount(db, {
      id: "alpaca-1",
      brokerType: "alpaca",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
      secretRef: "secret:alpaca-1",
    });
    secrets.get.mockResolvedValue(
      JSON.stringify({
        provider: "alpaca",
        api_key: "key",
        secret_key: "secret",
        mode: "paper",
      }),
    );
    const registry = new BrokerRegistry(
      new BrokerAccountsRepo(db),
      secrets as never,
    );

    const adapter = await registry.get("alpaca-1");

    expect(adapter).toBeInstanceOf(AlpacaAdapter);
    expect(secrets.get).toHaveBeenCalledWith("secret:alpaca-1");
  });

  it("throws when a live broker account is missing secrets", async () => {
    insertBrokerAccount(db, {
      id: "alpaca-1",
      brokerType: "alpaca",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
      secretRef: "secret:alpaca-1",
    });
    secrets.get.mockResolvedValue(null);
    const registry = new BrokerRegistry(
      new BrokerAccountsRepo(db),
      secrets as never,
    );

    await expect(registry.get("alpaca-1")).rejects.toMatchObject({
      code: "MISSING_SECRET",
    });
  });

  it("reports whether an account is a mock broker", () => {
    insertBrokerAccount(db, { id: "mock-1" });
    insertBrokerAccount(db, {
      id: "alpaca-1",
      brokerType: "alpaca",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
      secretRef: "secret:alpaca-1",
    });
    const registry = new BrokerRegistry(
      new BrokerAccountsRepo(db),
      secrets as never,
    );

    expect(registry.isMockAccount("mock-1")).toBe(true);
    expect(registry.isMockAccount("alpaca-1")).toBe(false);
    expect(registry.isMockAccount("missing")).toBe(false);
  });
});
