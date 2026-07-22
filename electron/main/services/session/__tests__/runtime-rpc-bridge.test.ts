import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MainRuntimeRpcBridge,
  WorkerRuntimeRpcClient,
  invokeOrchestratorDep,
} from "../runtime-rpc-bridge";

describe("invokeOrchestratorDep", () => {
  it("invokes a nested orchestrator dependency method", async () => {
    const deps = {
      sessionRepo: {
        getStatus: vi.fn(() => "active"),
      },
    } as never;

    await expect(
      invokeOrchestratorDep(deps, "sessionRepo.getStatus", ["session-1"]),
    ).resolves.toBe("active");
  });

  it("rejects unknown RPC paths", async () => {
    await expect(
      invokeOrchestratorDep({} as never, "missing.method", []),
    ).rejects.toThrow("Unknown orchestrator RPC path");
  });

  it("preserves class method receivers", async () => {
    class Repo {
      readonly value = "bound";
      read(): string {
        return this.value;
      }
    }
    await expect(
      invokeOrchestratorDep(
        { sessionRepo: new Repo() } as never,
        "sessionRepo.read",
        [],
      ),
    ).resolves.toBe("bound");
  });
});

describe("WorkerRuntimeRpcClient", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves RPC responses by id", async () => {
    const posted: unknown[] = [];
    const client = new WorkerRuntimeRpcClient((message) => {
      posted.push(message);
    });

    const pending = client.call("sessionRepo.getStatus", ["session-1"]);
    expect(posted).toHaveLength(1);

    client.handle({
      type: "rpc_response",
      id: 1,
      result: "paused",
    });

    await expect(pending).resolves.toBe("paused");
    client.dispose();
  });

  it("rejects RPC responses that carry errors", async () => {
    const client = new WorkerRuntimeRpcClient(() => undefined);
    const pending = client.call("sessionRepo.getStatus", ["session-1"]);

    client.handle({
      type: "rpc_response",
      id: 1,
      error: { code: "INTERNAL_ERROR", message: "boom" },
    });

    await expect(pending).rejects.toThrow("boom");
    client.dispose();
  });

  it("rejects calls when their deadline expires", async () => {
    vi.useFakeTimers();
    const client = new WorkerRuntimeRpcClient(() => undefined, 1_000);
    const pending = client.call("sessionRepo.getStatus", ["session-1"]);
    const rejection = expect(pending).rejects.toThrow(
      "Runtime RPC timed out: sessionRepo.getStatus",
    );

    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
    client.dispose();
  });

  it("ignores responses that arrive after the deadline", async () => {
    vi.useFakeTimers();
    const client = new WorkerRuntimeRpcClient(() => undefined, 1_000);
    const expired = client.call("sessionRepo.getStatus", ["session-1"]);
    const rejection = expect(expired).rejects.toThrow("Runtime RPC timed out");
    await vi.advanceTimersByTimeAsync(1_000);
    await rejection;

    client.handle({ type: "rpc_response", id: 1, result: "stale" });
    const current = client.call("sessionRepo.getStatus", ["session-1"]);
    client.handle({ type: "rpc_response", id: 2, result: "active" });

    await expect(current).resolves.toBe("active");
    client.dispose();
  });

  it("rejects pending and future calls when disposed", async () => {
    vi.useFakeTimers();
    const client = new WorkerRuntimeRpcClient(() => undefined, 1_000);
    const pending = client.call("sessionRepo.getStatus", ["session-1"]);

    client.dispose("worker stopped");

    await expect(pending).rejects.toThrow("worker stopped");
    await expect(client.call("sessionRepo.getStatus")).rejects.toThrow(
      "Runtime RPC disposed",
    );
    await vi.advanceTimersByTimeAsync(1_000);
  });
});

describe("MainRuntimeRpcBridge", () => {
  it("forwards worker events to the main event bus", async () => {
    const emit = vi.fn();
    const setRuntimeStatus = vi.fn();
    const bridge = new MainRuntimeRpcBridge(
      "session-1",
      {
        logger: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      } as never,
      { emit, setRuntimeStatus, clearRuntimeStatus: vi.fn() } as never,
      vi.fn(),
    );

    await bridge.handle({
      type: "event",
      name: "session_status_changed",
      payload: { sessionId: "session-1", status: "paused" },
    });

    expect(emit).toHaveBeenCalledWith("session_status_changed", {
      sessionId: "session-1",
      status: "paused",
    });
  });

  it("executes worker RPC requests against main orchestrator deps", async () => {
    const posted: unknown[] = [];
    const getStatus = vi.fn(() => "active");
    const bridge = new MainRuntimeRpcBridge(
      "session-1",
      {
        sessionRepo: { getStatus },
        logger: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      } as never,
      {
        emit: vi.fn(),
        setRuntimeStatus: vi.fn(),
        clearRuntimeStatus: vi.fn(),
      } as never,
      (message) => posted.push(message),
    );

    await bridge.handle({
      type: "rpc_request",
      id: 7,
      requestId: crypto.randomUUID(),
      path: "sessionRepo.getStatus",
      args: ["session-1"],
    });

    expect(getStatus).toHaveBeenCalledWith("session-1");
    expect(posted).toEqual([{ type: "rpc_response", id: 7, result: "active" }]);
  });
});
