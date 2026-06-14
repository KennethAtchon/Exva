import { describe, expect, it, vi } from "vitest";
import { brokerAllocationCheck } from "./broker-allocation-check";

describe("brokerAllocationCheck", () => {
  const session = { id: "session-1" } as const;

  it("accepts sessions whose allocations fit available capital", async () => {
    const result = await brokerAllocationCheck(
      session as never,
      {
        sessionBrokerAssignmentsRepo: {
          listBrokerAccountIds: () => ["broker-1"],
        },
        brokerBalanceCache: {
          refreshAll: async () => [{ id: "broker-1", balanceUsd: 10_000 }],
        },
        brokerCapital: {
          checkSessionStartFits: () => ({ ok: true as const }),
        },
      } as never,
    );

    expect(result).toEqual({ ok: true });
  });

  it("rejects sessions without broker assignments", async () => {
    const result = await brokerAllocationCheck(
      session as never,
      {
        sessionBrokerAssignmentsRepo: { listBrokerAccountIds: () => [] },
        brokerBalanceCache: { refreshAll: vi.fn() },
        brokerCapital: { checkSessionStartFits: vi.fn() },
      } as never,
    );

    expect(result).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
      message: expect.stringContaining("No broker accounts assigned"),
    });
  });

  it("surfaces balance refresh failures and capital gate failures", async () => {
    expect(
      await brokerAllocationCheck(
        session as never,
        {
          sessionBrokerAssignmentsRepo: {
            listBrokerAccountIds: () => ["broker-1"],
          },
          brokerBalanceCache: {
            refreshAll: async () => [
              { id: "broker-1", balanceUsd: 0, error: "timeout" },
            ],
          },
          brokerCapital: { checkSessionStartFits: vi.fn() },
        } as never,
      ),
    ).toMatchObject({
      ok: false,
      code: "BROKER_UNREACHABLE",
      message: expect.stringContaining("timeout"),
    });

    expect(
      await brokerAllocationCheck(
        session as never,
        {
          sessionBrokerAssignmentsRepo: {
            listBrokerAccountIds: () => ["broker-1"],
          },
          brokerBalanceCache: {
            refreshAll: async () => [{ id: "broker-1", balanceUsd: 10_000 }],
          },
          brokerCapital: {
            checkSessionStartFits: () => ({
              ok: false as const,
              failures: [
                {
                  reason: "session_cap_exceeded",
                  detail: "Allocated capital exceeds broker balance.",
                },
              ],
            }),
          },
        } as never,
      ),
    ).toMatchObject({
      ok: false,
      code: "BROKER_SESSION_CAP_EXCEEDED",
      message: "Allocated capital exceeds broker balance.",
    });
  });
});
