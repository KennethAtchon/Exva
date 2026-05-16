import { describe, expect, it } from "vitest";
import { SessionService } from "../session-service";

describe("SessionService.getPortfolioValue", () => {
  it("ignores mock broker balances and falls back when no truthful broker balance exists", async () => {
    const service = new SessionService({
      sessionRepo: {
        getFocused: () => ({ id: "session-1" }),
        requireById: () => ({ capitalLimitUsd: 5000 }),
      },
      sessionBrokerAssignmentsRepo: {
        listBrokerAccountIds: () => ["mock-broker"],
      },
      brokerRegistry: {
        get: async () => ({
          brokerType: "mock",
          launchCapable: false,
          getAccountBalance: async () => 100000,
        }),
      },
      eventsRepo: { insert: () => undefined },
      runtimeManager: {
        startSession: async () => ({}) as never,
        pauseSession: async () => undefined,
        resumeSession: async () => undefined,
        stopSession: async () => undefined,
        get: () => null,
      },
      preflight: async () => ({ ok: true as const }),
      orchestratorDeps: {} as never,
      liveReadiness: { check: async () => ({ readyToStart: true, checks: [] }) },
    } as never);

    await expect(service.getPortfolioValue()).resolves.toEqual({
      value: 5000,
      source: "session_capital_limit",
      brokerCount: 0,
    });
  });
});
