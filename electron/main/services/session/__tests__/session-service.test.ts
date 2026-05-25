import { describe, expect, it, vi } from "vitest";
import { SessionService } from "../session-service";

const emptyTradesRepo = {
  listOpenAndPending: () => [],
};

describe("SessionService stop guards", () => {
  it("drains to monitoring_only when open trades remain", async () => {
    const drainSession = vi.fn(async () => undefined);
    const insert = vi.fn();
    const service = new SessionService({
      sessionRepo: {
        requireById: () => ({
          id: "session-1",
          status: "active",
        }),
        getStatus: () => "monitoring_only",
        getFocusedSessionId: () => "session-1",
      },
      tradesRepo: {
        listOpenAndPending: () => [{ id: "trade-1", status: "open" }],
      },
      eventsRepo: { insert },
      runtimeManager: {
        drainSession,
        stopSession: vi.fn(async () => undefined),
      },
    } as never);

    await expect(service.stop("session-1")).resolves.toBe("monitoring_only");
    expect(drainSession).toHaveBeenCalledWith("session-1");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "INFO",
        message: expect.stringContaining("stop automatically when flat"),
      }),
    );
  });

  it("allows force stop while open trades remain", async () => {
    const stopSession = vi.fn(async () => undefined);
    const insert = vi.fn();
    const service = new SessionService({
      sessionRepo: {
        requireById: () => ({
          id: "session-1",
          status: "active",
        }),
        getStatus: () => "stopped",
        getFocusedSessionId: () => "session-1",
      },
      tradesRepo: {
        listOpenAndPending: () => [{ id: "trade-1", status: "open" }],
      },
      eventsRepo: { insert },
      runtimeManager: { stopSession },
    } as never);

    await expect(service.forceStop("session-1")).resolves.toBe("stopped");
    expect(stopSession).toHaveBeenCalledWith("session-1");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        level: "WARN",
        message: expect.stringContaining("force-stopped"),
      }),
    );
  });

  it("allows normal stop when no open trades remain", async () => {
    const stopSession = vi.fn(async () => undefined);
    const service = new SessionService({
      sessionRepo: {
        requireById: () => ({
          id: "session-1",
          status: "active",
        }),
        getStatus: () => "stopped",
        getFocusedSessionId: () => "session-1",
      },
      tradesRepo: emptyTradesRepo,
      eventsRepo: { insert: vi.fn() },
      runtimeManager: { stopSession },
    } as never);

    await expect(service.stop("session-1")).resolves.toBe("stopped");
    expect(stopSession).toHaveBeenCalledWith("session-1");
  });
});

describe("SessionService.getPortfolioValue", () => {
  it("ignores mock broker balances and falls back when no truthful broker balance exists", async () => {
    const service = new SessionService({
      sessionRepo: {
        getFocused: () => ({ id: "session-1" }),
        requireById: () => ({ id: "session-1" }),
      },
      tradesRepo: emptyTradesRepo,
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
      tradesRepo: emptyTradesRepo,
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
      tradesRepo: emptyTradesRepo,
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

  it("allows restarting a stopped session", async () => {
    const insert = vi.fn();
    const startSession = vi.fn(async () => ({}) as never);
    const service = new SessionService({
      sessionRepo: {
        requireById: () => ({
          id: "session-1",
          status: "stopped",
          executionMode: "paper_only",
        }),
        getStatus: () => "active",
      },
      tradesRepo: emptyTradesRepo,
      eventsRepo: { insert },
      runtimeManager: { startSession },
      preflight: async () => ({ ok: true as const }),
      orchestratorDeps: {} as never,
      liveReadiness: {
        check: async () => ({ readyToStart: true, checks: [] }),
      },
    } as never);

    await expect(service.start("session-1")).resolves.toBe("active");
    expect(startSession).toHaveBeenCalledWith("session-1");
  });
});
