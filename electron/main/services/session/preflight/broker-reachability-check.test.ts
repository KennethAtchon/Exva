import { describe, expect, it, vi } from "vitest";
import { brokerReachabilityCheck } from "./broker-reachability-check";

describe("brokerReachabilityCheck", () => {
  const session = {
    id: "session-1",
    instrumentClasses: ["stock"],
    instrumentScope: "NVDA",
  } as const;

  it("accepts reachable brokers that cover the session instrument classes", async () => {
    const result = await brokerReachabilityCheck(
      session as never,
      {
        sessionBrokerAssignmentsRepo: {
          listBrokerAccountIds: () => ["broker-1"],
        },
        sessionSelectorSettingsRepo: {
          get: () => ({ aiPickerEnabled: false }),
        },
        brokerAccountsRepo: {
          find: () => ({
            id: "broker-1",
            name: "Paper Mock",
            supportedInstrumentClasses: ["stock"],
          }),
        },
        brokerRouting: {
          resolveBrokerAccountId: () => "broker-1",
        },
        brokerRegistry: {
          get: async () => ({
            testConnection: async () => ({ ok: true as const }),
          }),
        },
      } as never,
    );

    expect(result).toEqual({ ok: true });
  });

  it("rejects sessions without broker assignments", async () => {
    const result = await brokerReachabilityCheck(
      session as never,
      {
        sessionBrokerAssignmentsRepo: { listBrokerAccountIds: () => [] },
        sessionSelectorSettingsRepo: {
          get: () => ({ aiPickerEnabled: false }),
        },
        brokerAccountsRepo: { find: () => null },
        brokerRouting: { resolveBrokerAccountId: vi.fn() },
        brokerRegistry: { get: vi.fn() },
      } as never,
    );

    expect(result).toMatchObject({
      ok: false,
      code: "NO_BROKER",
      message: expect.stringContaining("Assign at least one broker"),
    });
  });

  it("rejects missing brokers, unsupported classes, routing failures, and unreachable adapters", async () => {
    expect(
      await brokerReachabilityCheck(
        session as never,
        {
          sessionBrokerAssignmentsRepo: {
            listBrokerAccountIds: () => ["missing-broker"],
          },
          sessionSelectorSettingsRepo: {
            get: () => ({ aiPickerEnabled: false }),
          },
          brokerAccountsRepo: { find: () => null },
          brokerRouting: { resolveBrokerAccountId: vi.fn() },
          brokerRegistry: { get: vi.fn() },
        } as never,
      ),
    ).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
    });

    expect(
      await brokerReachabilityCheck(
        session as never,
        {
          sessionBrokerAssignmentsRepo: {
            listBrokerAccountIds: () => ["broker-crypto"],
          },
          sessionSelectorSettingsRepo: {
            get: () => ({ aiPickerEnabled: false }),
          },
          brokerAccountsRepo: {
            find: () => ({
              id: "broker-crypto",
              name: "Crypto Only",
              supportedInstrumentClasses: ["crypto"],
            }),
          },
          brokerRouting: { resolveBrokerAccountId: vi.fn() },
          brokerRegistry: { get: vi.fn() },
        } as never,
      ),
    ).toMatchObject({
      ok: false,
      code: "UNSUPPORTED_INSTRUMENT",
    });

    expect(
      await brokerReachabilityCheck(
        session as never,
        {
          sessionBrokerAssignmentsRepo: {
            listBrokerAccountIds: () => ["broker-1"],
          },
          sessionSelectorSettingsRepo: {
            get: () => ({ aiPickerEnabled: false }),
          },
          brokerAccountsRepo: {
            find: () => ({
              id: "broker-1",
              name: "Paper Mock",
              supportedInstrumentClasses: ["stock"],
            }),
          },
          brokerRouting: {
            resolveBrokerAccountId: () => {
              throw new Error("no override");
            },
          },
          brokerRegistry: { get: vi.fn() },
        } as never,
      ),
    ).toMatchObject({
      ok: false,
      code: "NO_BROKER",
      message: expect.stringContaining("Cannot resolve broker"),
    });

    expect(
      await brokerReachabilityCheck(
        session as never,
        {
          sessionBrokerAssignmentsRepo: {
            listBrokerAccountIds: () => ["broker-1"],
          },
          sessionSelectorSettingsRepo: {
            get: () => ({ aiPickerEnabled: false }),
          },
          brokerAccountsRepo: {
            find: () => ({
              id: "broker-1",
              name: "Paper Mock",
              supportedInstrumentClasses: ["stock"],
            }),
          },
          brokerRouting: { resolveBrokerAccountId: () => "broker-1" },
          brokerRegistry: {
            get: async () => ({
              testConnection: async () => ({
                ok: false as const,
                message: "offline",
              }),
            }),
          },
        } as never,
      ),
    ).toMatchObject({
      ok: false,
      code: "BROKER_UNREACHABLE",
      message: "offline",
    });
  });
});
