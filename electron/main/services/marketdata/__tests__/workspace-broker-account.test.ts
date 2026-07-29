import { describe, expect, it } from "vitest";
import { resolveWorkspaceBrokerAccountId } from "../workspace-broker-account";

describe("resolveWorkspaceBrokerAccountId", () => {
  const alpacaA = {
    id: "alpaca-a",
    brokerType: "alpaca",
    supportedInstrumentClasses: ["stock", "crypto"] as const,
  };
  const alpacaB = {
    id: "alpaca-b",
    brokerType: "alpaca",
    supportedInstrumentClasses: ["stock", "crypto"] as const,
  };

  it("prefers the global routing default over first-listed account", () => {
    const id = resolveWorkspaceBrokerAccountId({
      brokerType: "alpaca",
      instrumentClass: "crypto",
      listAccounts: () => [alpacaA, alpacaB],
      findAccount: (accountId) =>
        [alpacaA, alpacaB].find((row) => row.id === accountId),
      listGlobalDefaults: () => [
        { instrumentClass: "crypto", defaultBrokerAccountId: "alpaca-b" },
      ],
    });
    expect(id).toBe("alpaca-b");
  });

  it("returns the sole compatible account when no default exists", () => {
    const id = resolveWorkspaceBrokerAccountId({
      brokerType: "alpaca",
      instrumentClass: "crypto",
      listAccounts: () => [alpacaA],
      findAccount: (accountId) => (accountId === alpacaA.id ? alpacaA : null),
      listGlobalDefaults: () => [],
    });
    expect(id).toBe("alpaca-a");
  });

  it("returns null when multiple accounts match and no default is set", () => {
    const id = resolveWorkspaceBrokerAccountId({
      brokerType: "alpaca",
      instrumentClass: "crypto",
      listAccounts: () => [alpacaA, alpacaB],
      findAccount: () => null,
      listGlobalDefaults: () => [],
    });
    expect(id).toBeNull();
  });
});
