import { describe, expect, it, vi } from "vitest";
import {
  createOrchestratorDeps,
  InProcessSessionRuntimeHost,
} from "../session-runtime-host";
import type { OrchestratorDeps } from "../session-types";

describe("InProcessSessionRuntimeHost", () => {
  it("passes manager deps through createOrchestratorDeps unchanged", () => {
    const deps = { marker: "runtime-deps" } as never;
    expect(createOrchestratorDeps(deps)).toBe(deps);
  });

  it("boots an in-process runtime using injected orchestrator and monitor hooks", async () => {
    const orchestrator = {
      start: vi.fn(async () => undefined),
      pause: vi.fn(async () => undefined),
      resume: vi.fn(async () => undefined),
      restartFromAttention: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      pauseAfterCurrentStep: vi.fn(),
      retryStep: vi.fn(),
      runApprovalRecheck: vi.fn(),
      resolveApproval: vi.fn(() => false),
      hasApprovalCallback: vi.fn(() => false),
    };
    const tradeMonitor = { start: vi.fn(), stop: vi.fn() };
    const host = new InProcessSessionRuntimeHost({
      sessionRepo: {
        requireById: () => ({ id: "session-1", status: "idle" }),
      },
      createOrchestrator: () => orchestrator,
      createTradeMonitor: () => tradeMonitor,
    } as never);

    const runtime = await host.createRuntime("session-1");
    await runtime.initialize("active");

    expect(runtime.sessionId).toBe("session-1");
    expect(orchestrator.start).toHaveBeenCalledTimes(1);
    expect(tradeMonitor.start).toHaveBeenCalledTimes(1);
    await runtime.stop();
    expect(orchestrator.stop).toHaveBeenCalledTimes(1);
    expect(tradeMonitor.stop).toHaveBeenCalledTimes(1);
  });
});

describe("runtime host selection", () => {
  it("allows SessionRuntimeManager to use an injected host implementation", async () => {
    const { SessionRuntimeManager } =
      await import("../session-runtime-manager");
    const createRuntime = vi.fn(async () => ({
      sessionId: "session-1",
      initialize: vi.fn(async () => undefined),
      pause: vi.fn(),
      resume: vi.fn(),
      drainStop: vi.fn(),
      stop: vi.fn(),
      shutdown: vi.fn(),
      orchestrator: {} as never,
      tradeMonitor: { start: vi.fn(), stop: vi.fn() },
      startedAt: new Date().toISOString(),
      status: "starting" as const,
      uptimeMin: () => 0,
    }));
    const host = { createRuntime, shutdownAll: vi.fn() };
    const manager = new SessionRuntimeManager(
      {
        sessionRepo: {
          requireById: () => ({ id: "session-1", status: "idle" }),
          setStatus: vi.fn(),
          getStatus: vi.fn(() => "active"),
        },
        tradesRepo: { listOpenAndPending: () => [] },
        bus: {
          on: vi.fn(() => () => undefined),
          setRuntimeStatus: vi.fn(),
          clearRuntimeStatus: vi.fn(),
          emit: vi.fn(),
        },
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          debug: vi.fn(),
        },
        createOrchestrator: vi.fn(),
        createTradeMonitor: vi.fn(),
      } as never,
      host,
    );

    await manager.startSession("session-1");
    expect(createRuntime).toHaveBeenCalledWith("session-1");
    expect(manager.get("session-1")).not.toBeNull();
  });
});

describe("OrchestratorDeps shape", () => {
  it("matches the keys expected by runtime worker proxies", async () => {
    const { createWorkerOrchestratorDeps } =
      await import("../runtime-worker-deps");
    const posted: unknown[] = [];
    const deps = createWorkerOrchestratorDeps("session-1", (message) => {
      posted.push(message);
    });

    const expectedKeys: Array<keyof OrchestratorDeps> = [
      "sessionRepo",
      "strategyContextService",
      "tradesRepo",
      "tradeApprovalsRepo",
      "agentRunsRepo",
      "agentMessagesRepo",
      "eventsRepo",
      "statsRepo",
      "sessionExecutionStepsRepo",
      "providerAccountsRepo",
      "workspacePreferencesRepo",
      "capitalReservationsRepo",
      "capitalReservation",
      "brokerRoutingRepo",
      "sessionBrokerAssignmentsRepo",
      "brokerAccountsRepo",
      "brokerRegistry",
      "brokerRouting",
      "brokerBalanceCache",
      "brokerCapital",
      "brokerAllocationGate",
      "instrumentNormalizer",
      "instrumentCacheRepo",
      "signalSourcesRepo",
      "ai",
      "riskEngine",
      "bus",
      "logger",
    ];

    for (const key of expectedKeys) {
      expect(deps).toHaveProperty(key);
    }

    void deps.sessionRepo.getStatus("session-1");
    expect(posted[0]).toMatchObject({
      type: "rpc_request",
      path: "sessionRepo.getStatus",
      args: ["session-1"],
    });
  });
});
