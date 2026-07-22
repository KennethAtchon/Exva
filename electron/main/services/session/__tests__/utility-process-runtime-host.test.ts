import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../../infra/event-bus";
import { createLogger } from "../../infra/log";

const fork = vi.hoisted(() => vi.fn());
const connect = vi.hoisted(() => vi.fn());

vi.mock("electron", () => ({
  utilityProcess: { fork },
}));

vi.mock("../utility-process-session-runtime", () => ({
  UtilityProcessSessionRuntime: {
    connect,
  },
}));

import {
  resolveSessionWorkerPath,
  UtilityProcessSessionRuntimeHost,
} from "../utility-process-runtime-host";

describe("UtilityProcessSessionRuntimeHost", () => {
  beforeEach(() => {
    fork.mockReset();
    connect.mockReset();
  });

  it("resolves the bundled worker entry path", () => {
    expect(resolveSessionWorkerPath()).toMatch(/session-runtime-worker\.cjs$/);
  });

  it("forks a worker, wires RPC messages, and tracks runtimes for shutdown", async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const child = {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        handlers.set(event, handler);
      }),
      postMessage: vi.fn(),
      stderr: { on: vi.fn() },
      kill: vi.fn(),
      off: vi.fn(),
    };
    fork.mockReturnValue(child);

    const runtime = {
      handleMessage: vi.fn(),
      handleExit: vi.fn(),
      shutdown: vi.fn(async () => undefined),
    };
    connect.mockResolvedValue(runtime);

    const host = new UtilityProcessSessionRuntimeHost(
      {
        sessionRepo: { requireById: () => ({ id: "session-1" }) },
        createOrchestrator: vi.fn(),
        createTradeMonitor: vi.fn(),
      } as never,
      new EventBus(),
      createLogger("utility-host-test"),
    );

    const created = await host.createRuntime("session-1");

    expect(fork).toHaveBeenCalledWith(
      resolveSessionWorkerPath(),
      [],
      expect.objectContaining({
        serviceName: expect.stringContaining("exva-session-"),
      }),
    );
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        child,
      }),
    );
    expect(created).toBe(runtime);

    const message = {
      type: "rpc_request",
      id: 1,
      requestId: crypto.randomUUID(),
      path: "ping",
      args: [],
    };
    handlers.get("message")?.(message);
    expect(runtime.handleMessage).toHaveBeenCalledWith(message);

    handlers.get("exit")?.(1);
    expect(runtime.handleExit).toHaveBeenCalledWith(1);

    await host.shutdownAll();
    expect(runtime.shutdown).toHaveBeenCalledTimes(0);

    const secondRuntime = {
      handleMessage: vi.fn(),
      handleExit: vi.fn(),
      shutdown: vi.fn(async () => undefined),
    };
    connect.mockResolvedValueOnce(secondRuntime);
    await host.createRuntime("session-2");
    await host.shutdownAll();
    expect(secondRuntime.shutdown).toHaveBeenCalledTimes(1);
  });

  it("kills the child when runtime connection fails", async () => {
    const child = {
      on: vi.fn(),
      postMessage: vi.fn(),
      stderr: { on: vi.fn() },
      kill: vi.fn(),
    };
    fork.mockReturnValue(child);
    connect.mockRejectedValue(new Error("worker ready timeout"));
    const host = new UtilityProcessSessionRuntimeHost(
      {
        sessionRepo: { requireById: () => ({ id: "session-1" }) },
        createOrchestrator: vi.fn(),
        createTradeMonitor: vi.fn(),
      } as never,
      new EventBus(),
      createLogger("utility-host-connect-failure-test"),
    );

    await expect(host.createRuntime("session-1")).rejects.toThrow(
      "worker ready timeout",
    );

    expect(child.kill).toHaveBeenCalledTimes(1);
  });
});
