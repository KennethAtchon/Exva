import { describe, expect, it, vi } from "vitest";
import { DEFAULT_MOCK_ACCOUNT_BALANCE_USD } from "@electron/shared/domain/mock-scenario";
import { BrokerAccountsRepo } from "./broker-accounts-repo";

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
});
