import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import { insertBrokerAccount } from "../../../db/test-fixtures";
import { BrokerAccountsRepo } from "../../../db/repositories/brokers/broker-accounts-repo";
import { BrokerBalanceCacheService } from "../broker-balance-cache-service";
import type { BrokerRegistry } from "../broker-registry";

describe("BrokerBalanceCacheService", () => {
  let db = createTestDb();

  beforeEach(() => {
    db = createTestDb();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T12:00:00.000Z"));
  });

  afterEach(() => {
    db.sqlite.close();
    vi.useRealTimers();
  });

  it("returns a fresh cached balance without hitting the broker", async () => {
    insertBrokerAccount(db, { id: "broker-1" });
    const repo = new BrokerAccountsRepo(db);
    repo.updateBalanceCache("broker-1", 12_345, "2026-06-13T11:58:00.000Z");
    repo.updateSettings("broker-1", { balanceRefreshIntervalMin: 5 });
    const getAccountBalance = vi.fn(async () => 99_999);
    const service = createService(db, getAccountBalance);

    const balance = await service.getBalance("broker-1");

    expect(balance).toBe(12_345);
    expect(getAccountBalance).not.toHaveBeenCalled();
  });

  it("refreshes stale balances through the registry adapter", async () => {
    insertBrokerAccount(db, { id: "broker-1" });
    const repo = new BrokerAccountsRepo(db);
    repo.updateBalanceCache("broker-1", 1000, "2026-06-13T11:00:00.000Z");
    repo.updateSettings("broker-1", { balanceRefreshIntervalMin: 5 });
    const getAccountBalance = vi.fn(async () => 2500);
    const service = createService(db, getAccountBalance);

    const balance = await service.getBalance("broker-1");
    const cache = repo.getBalanceCache("broker-1");

    expect(balance).toBe(2500);
    expect(getAccountBalance).toHaveBeenCalledTimes(1);
    expect(cache.balanceCacheUsd).toBe(2500);
    expect(cache.balanceCachedAt).toBe("2026-06-13T12:00:00.000Z");
  });

  it("captures per-account refresh failures in refreshAll", async () => {
    insertBrokerAccount(db, { id: "ok-broker" });
    insertBrokerAccount(db, { id: "bad-broker" });
    const getAccountBalance = vi.fn(async (id?: string) => {
      if (id === "bad-broker") throw new Error("broker offline");
      return 1000;
    });
    const registry = {
      get: vi.fn(async (id: string) => ({
        getAccountBalance: async () => getAccountBalance(id),
      })),
    } as unknown as BrokerRegistry;
    const service = new BrokerBalanceCacheService(
      new BrokerAccountsRepo(db),
      registry,
    );

    const results = await service.refreshAll(["ok-broker", "bad-broker"]);

    expect(results).toEqual([
      { id: "ok-broker", balance: 1000 },
      { id: "bad-broker", error: "broker offline" },
    ]);
  });
});

function createService(
  db: ReturnType<typeof createTestDb>,
  getAccountBalance: () => Promise<number>,
) {
  const registry = {
    get: vi.fn(async () => ({ getAccountBalance })),
  } as unknown as BrokerRegistry;
  return new BrokerBalanceCacheService(new BrokerAccountsRepo(db), registry);
}
