import { describe, expect, it, vi } from "vitest";
import type { Trade } from "@/lib/types";
import { SessionRuntimeManager } from "../session-runtime-manager";
import type { SessionRuntimeHost } from "../session-runtime-host";

describe("SessionRuntimeManager drain completion", () => {
  it("completes drain stop when the last open trade closes", async () => {
    let sessionStatus: "monitoring_only" | "stopped" = "monitoring_only";
    const openTrades: Array<{ id: string; status: string }> = [
      { id: "trade-1", status: "open" },
    ];
    let tradeClosedHandler: ((trade: Trade) => void) | undefined;

    const runtime = {
      sessionId: "session-1",
      drainStop: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    };

    const manager = new SessionRuntimeManager({
      sessionRepo: {
        requireById: () => ({ id: "session-1", status: sessionStatus }),
        getStatus: () => sessionStatus,
        setStatus: (status: string) => {
          sessionStatus = status as typeof sessionStatus;
        },
      },
      tradesRepo: {
        listOpenAndPending: () => openTrades,
      },
      bus: {
        on: vi.fn((_event, handler) => {
          tradeClosedHandler = handler as (trade: Trade) => void;
          return () => undefined;
        }),
        setRuntimeStatus: vi.fn(),
        emit: vi.fn(),
        clearRuntimeStatus: vi.fn(),
      },
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      createOrchestrator: vi.fn(),
      createTradeMonitor: vi.fn(),
    } as never);

    (
      manager as unknown as { runtimes: Map<string, typeof runtime> }
    ).runtimes.set("session-1", runtime);

    const stopSession = vi
      .spyOn(manager, "stopSession")
      .mockImplementation(async () => {
        sessionStatus = "stopped";
      });

    await manager.drainSession("session-1");
    expect(runtime.drainStop).toHaveBeenCalled();
    expect(sessionStatus).toBe("monitoring_only");

    openTrades.length = 0;
    expect(tradeClosedHandler).toBeDefined();
    await tradeClosedHandler?.({
      id: "trade-1",
      sessionId: "session-1",
      status: "closed",
    } as Trade);

    expect(stopSession).toHaveBeenCalledWith("session-1");
    expect(sessionStatus).toBe("stopped");
  });

  it("coalesces concurrent startSession calls into a single runtime create", async () => {
    let resolveCreate: ((runtime: unknown) => void) | undefined;
    const createRuntime = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const initialize = vi.fn(async () => undefined);
    const runtime = {
      sessionId: "session-1",
      initialize,
      pause: vi.fn(),
      resume: vi.fn(),
      drainStop: vi.fn(),
      stop: vi.fn(),
    };

    const manager = new SessionRuntimeManager(
      {
        sessionRepo: {
          requireById: () => ({
            id: "session-1",
            status: "draft",
            instrumentScope: "SPY",
          }),
          setStatus: vi.fn(),
          getStatus: vi.fn(() => "draft"),
        },
        tradesRepo: { listOpenAndPending: vi.fn(() => []) },
        tradeApprovalsRepo: {},
        sessionExecutionStepsRepo: {},
        capitalReservationsRepo: {},
        capitalReservation: {
          runInTransaction: <T>(fn: () => T) => fn(),
        },
        brokerRegistry: {},
        eventsRepo: {},
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
        },
        bus: {
          on: vi.fn(() => () => undefined),
          setRuntimeStatus: vi.fn(),
          clearRuntimeStatus: vi.fn(),
          emit: vi.fn(),
        },
        signals: {
          onSessionResumed: vi.fn(),
          replayStartup: vi.fn(),
        },
        createOrchestrator: vi.fn(),
        createTradeMonitor: vi.fn(),
      } as never,
      {
        createRuntime,
      } as unknown as SessionRuntimeHost,
    );

    const first = manager.startSession("session-1");
    const second = manager.startSession("session-1");
    expect(createRuntime).toHaveBeenCalledTimes(1);
    resolveCreate?.(runtime);
    await expect(Promise.all([first, second])).resolves.toEqual([
      runtime,
      runtime,
    ]);
    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(initialize).toHaveBeenCalledTimes(1);
  });

  it("does not inject manual tickers on startup when the initial selector cycle already covers instrumentScope", async () => {
    let runtimeStatus = "starting";
    const initialize = vi.fn(async () => {
      runtimeStatus = "active";
    });
    const runtime = {
      sessionId: "session-1",
      status: runtimeStatus,
      orchestrator: {
        stop: vi.fn(async () => undefined),
      },
      tradeMonitor: {
        start: vi.fn(),
        stop: vi.fn(),
      },
      startedAt: new Date().toISOString(),
      uptimeMin: vi.fn(() => 0),
      initialize,
      pause: vi.fn(async () => undefined),
      resume: vi.fn(async () => undefined),
      drainStop: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
    };
    const createRuntime = vi.fn(async () => runtime);

    const manager = new SessionRuntimeManager(
      {
        sessionRepo: {
          requireById: () => ({
            id: "session-1",
            status: "draft",
            instrumentScope: "SPY, QQQ",
          }),
          setStatus: vi.fn(),
          getStatus: vi.fn(() => "draft"),
        },
        tradesRepo: { listOpenAndPending: vi.fn(() => []) },
        tradeApprovalsRepo: {},
        sessionExecutionStepsRepo: {},
        capitalReservationsRepo: {},
        capitalReservation: {
          runInTransaction: <T>(fn: () => T) => fn(),
        },
        brokerRegistry: {},
        eventsRepo: {},
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
        },
        bus: {
          on: vi.fn(() => () => undefined),
          setRuntimeStatus: vi.fn(),
          clearRuntimeStatus: vi.fn(),
          emit: vi.fn(),
        },
        signals: {
          onSessionResumed: vi.fn(),
          replayStartup: vi.fn(),
        },
        createOrchestrator: vi.fn(),
        createTradeMonitor: vi.fn(),
      } as never,
      {
        createRuntime,
      } as unknown as SessionRuntimeHost,
    );

    await manager.startSession("session-1");

    expect(createRuntime).toHaveBeenCalledWith("session-1");
    expect(initialize).toHaveBeenCalledWith("active");
  });
});
