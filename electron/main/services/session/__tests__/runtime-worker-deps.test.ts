import { describe, expect, it, vi } from "vitest";
import type { OrchestratorDeps } from "../session-types";
import { createWorkerOrchestratorDeps } from "../runtime-worker-deps";

const ORCHESTRATOR_DEP_KEYS: Array<keyof OrchestratorDeps> = [
  "sessionRepo",
  "sessionStrategiesRepo",
  "strategyContextService",
  "tradesRepo",
  "tradeApprovalsRepo",
  "agentRunsRepo",
  "agentMessagesRepo",
  "eventsRepo",
  "statsRepo",
  "sessionAiPhasesRepo",
  "sessionSelectorSettingsRepo",
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

describe("createWorkerOrchestratorDeps", () => {
  it("exposes every orchestrator dependency expected by the main process", () => {
    const deps = createWorkerOrchestratorDeps("session-1", vi.fn());

    expect(Object.keys(deps).sort()).toEqual([...ORCHESTRATOR_DEP_KEYS].sort());
  });

  it("routes repo calls through the worker RPC bridge", () => {
    const posted: unknown[] = [];
    const deps = createWorkerOrchestratorDeps("session-1", (message) => {
      posted.push(message);
    });

    void deps.tradesRepo.listOpenAndPending("session-1");
    void deps.brokerRouting.resolveBrokerAccountId("session-1", "stock");
    void deps.logger.info({ sessionId: "session-1" }, "booted");

    expect(posted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "rpc_request",
          path: "tradesRepo.listOpenAndPending",
          args: ["session-1"],
        }),
        expect.objectContaining({
          type: "rpc_request",
          path: "brokerRouting.resolveBrokerAccountId",
          args: ["session-1", "stock"],
        }),
        expect.objectContaining({
          type: "log",
          level: "info",
          message: "booted",
        }),
      ]),
    );
  });

  it("forwards worker events through the session-scoped bus shim", () => {
    const posted: unknown[] = [];
    const deps = createWorkerOrchestratorDeps("session-1", (message) => {
      posted.push(message);
    });

    deps.bus.emit("session_status_changed", {
      sessionId: "session-1",
      status: "active",
    });

    expect(posted).toContainEqual(
      expect.objectContaining({
        type: "event",
        name: "session_status_changed",
        payload: { sessionId: "session-1", status: "active" },
      }),
    );
  });
});
