import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import { insertBrokerAccount } from "../../../db/test-fixtures";
import { BrokerAccountsRepo } from "../../../db/repositories/brokers/broker-accounts-repo";
import { BrokerBalanceTicker } from "../broker-balance-ticker";
import type { BrokerBalanceCacheService } from "../broker-balance-cache-service";
import type { EventBus } from "../../infra/event-bus";

describe("BrokerBalanceTicker", () => {
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

  it("emits broker_balance_updated when a stale account is refreshed", async () => {
    const repo = new BrokerAccountsRepo(db);
    insertBrokerAccount(db, { id: "broker-1" });
    insertBrokerAccount(db, { id: "broker-fresh" });
    repo.updateBalanceCache("broker-1", 1000, "2026-06-13T11:00:00.000Z");
    repo.updateBalanceCache("broker-fresh", 1000, "2026-06-13T11:59:00.000Z");
    repo.updateSettings("broker-1", { balanceRefreshIntervalMin: 5 });
    repo.updateSettings("broker-fresh", { balanceRefreshIntervalMin: 5 });
    const refreshBalance = vi.fn(async (id: string) =>
      id === "broker-1" ? 42_000 : 10_000,
    );
    const emit = vi.fn();
    const ticker = new BrokerBalanceTicker(
      new BrokerAccountsRepo(db),
      { refreshBalance } as unknown as BrokerBalanceCacheService,
      { emit } as unknown as EventBus,
      { warn: vi.fn() } as never,
      1_000,
    );

    ticker.start();
    await vi.advanceTimersByTimeAsync(1_000);
    ticker.stop();

    expect(refreshBalance).toHaveBeenCalledTimes(1);
    expect(refreshBalance).toHaveBeenCalledWith("broker-1");
    expect(emit).toHaveBeenCalledWith(
      "broker_balance_updated",
      expect.objectContaining({
        brokerAccountId: "broker-1",
        balanceUsd: 42_000,
        cachedAt: expect.any(String),
      }),
    );
  });

  it("logs and retains stale cache when refresh fails", async () => {
    const repo = new BrokerAccountsRepo(db);
    insertBrokerAccount(db, { id: "broker-1" });
    repo.updateBalanceCache("broker-1", 1000, "2026-06-13T11:00:00.000Z");
    repo.updateSettings("broker-1", { balanceRefreshIntervalMin: 5 });
    const refreshBalance = vi.fn(async () => {
      throw new Error("network down");
    });
    const warn = vi.fn();
    const emit = vi.fn();
    const ticker = new BrokerBalanceTicker(
      new BrokerAccountsRepo(db),
      { refreshBalance } as unknown as BrokerBalanceCacheService,
      { emit } as unknown as EventBus,
      { warn } as never,
      1_000,
    );

    ticker.start();
    await vi.advanceTimersByTimeAsync(1_000);
    ticker.stop();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ brokerAccountId: "broker-1" }),
      expect.stringContaining("balance refresh failed"),
    );
    expect(emit).not.toHaveBeenCalled();
  });
});
