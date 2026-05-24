import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MOCK_ACCOUNT_BALANCE_USD } from "@electron/shared/domain/mock-scenario";
import { BrokerAccountsRepo } from "./broker-accounts-repo";
import { toBrokerAccount } from "../system/mappers";

describe("BrokerAccountsRepo", () => {
  it("seeds a cached 100k balance for new mock brokers", () => {
    const run = vi.fn();
    const values = vi.fn().mockReturnValue({ run });
    const insert = vi.fn().mockReturnValue({ values });
    const repo = new BrokerAccountsRepo({ db: { insert } } as never);

    vi.spyOn(repo, "require").mockReturnValue({} as never);

    repo.insert({
      id: "mock-paper",
      name: "Mock Paper",
      brokerType: "mock",
      supportedInstrumentClasses: ["stock", "crypto"],
      mode: "paper",
      secretRef: "secret:mock-paper",
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        balanceCacheUsd: DEFAULT_MOCK_ACCOUNT_BALANCE_USD,
        balanceCachedAt: expect.any(String),
      }),
    );
    expect(run).toHaveBeenCalled();
  });

  it("falls back to a 100k display balance for older mock brokers with null cache", () => {
    const account = toBrokerAccount({
      id: "legacy-mock",
      name: "Legacy Mock",
      broker_type: "mock",
      supported_instrument_classes: JSON.stringify(["stock"]),
      mode: "paper",
      mock_scenario_kind: "clean_breakout",
      balance_cache_usd: null,
      balance_cached_at: null,
      max_sessions: 10,
      allocation_enforcement: "hard",
      balance_refresh_interval_min: 5,
      secret_ref: "secret:legacy-mock",
      updated_at: new Date().toISOString(),
    });

    expect(account.balanceCacheUsd).toBe(DEFAULT_MOCK_ACCOUNT_BALANCE_USD);
    expect(account.balanceCachedAt).toBeNull();
  });
});
