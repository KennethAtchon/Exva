import { describe, expect, it, vi } from "vitest";
import { SessionService } from "../session-service";

describe("SessionService.getPortfolioValue", () => {
  it("ignores mock broker balances and falls back when no truthful broker balance exists", async () => {
    const service = new SessionService({
      sessionRepo: {
        getFocused: () => ({ id: "session-1" }),
        requireById: () => ({ id: "session-1" }),
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
      liveReadiness: {
        check: async () => ({ readyToStart: true, checks: [] }),
      },
    } as never);

    await expect(service.getPortfolioValue()).resolves.toEqual({
      value: 0,
      source: "broker",
      brokerCount: 0,
    });
  });
});

describe("SessionService.start", () => {
  it("emits start lifecycle events in execution order", async () => {
    const insert = vi.fn();
    const service = new SessionService({
      sessionRepo: {
        requireById: () => ({
          id: "session-1",
          status: "idle",
          executionMode: "paper_only",
        }),
        getStatus: () => "active",
      },
      eventsRepo: { insert },
      runtimeManager: {
        startSession: async () => ({}) as never,
      },
      preflight: async () => ({ ok: true as const }),
      orchestratorDeps: {} as never,
      liveReadiness: {
        check: async () => ({ readyToStart: true, checks: [] }),
      },
    } as never);

    await expect(service.start("session-1")).resolves.toBe("active");

    expect(insert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: "Session starting...",
        level: "INFO",
      }),
    );
    expect(insert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        message: "Session runtime ready.",
        level: "INFO",
      }),
    );
  });

  it("emits a startup failure event when runtime initialization throws", async () => {
    const insert = vi.fn();
    const service = new SessionService({
      sessionRepo: {
        requireById: () => ({
          id: "session-1",
          status: "idle",
          executionMode: "paper_only",
        }),
      },
      eventsRepo: { insert },
      runtimeManager: {
        startSession: async () => {
          throw new Error("selector crashed");
        },
      },
      preflight: async () => ({ ok: true as const }),
      orchestratorDeps: {} as never,
      liveReadiness: {
        check: async () => ({ readyToStart: true, checks: [] }),
      },
    } as never);

    await expect(service.start("session-1")).rejects.toThrow(
      "selector crashed",
    );

    expect(insert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: "Session starting...",
        level: "INFO",
      }),
    );
    expect(insert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        message: "Session failed to start: selector crashed",
        level: "ERROR",
      }),
    );
  });
});
