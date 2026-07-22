import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UtilityProcessSessionRuntime } from "../utility-process-session-runtime";

function createChild() {
  return Object.assign(new EventEmitter(), {
    postMessage: vi.fn(),
    kill: vi.fn(),
  });
}

async function connectRuntime() {
  const child = createChild();
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const onDispose = vi.fn();
  const recordDiagnostic = vi.fn();
  const pending = UtilityProcessSessionRuntime.connect({
    sessionId: "session-1",
    child: child as never,
    bridge: { handle: vi.fn() } as never,
    logger: logger as never,
    onDispose,
    recordDiagnostic,
  });
  child.emit("message", { type: "worker_ready" });

  return {
    runtime: await pending,
    child,
    logger,
    onDispose,
    recordDiagnostic,
  };
}

describe("UtilityProcessSessionRuntime", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("terminates the child when a normal command times out", async () => {
    vi.useFakeTimers();
    const { runtime, child, logger, onDispose, recordDiagnostic } =
      await connectRuntime();
    const command = runtime.pause();
    const rejection = expect(command).rejects.toThrow(
      "Utility command timed out: pause",
    );

    await vi.advanceTimersByTimeAsync(30_000);

    await rejection;
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "utility.command.timeout",
        command: "pause",
        deadlineMs: 30_000,
      }),
      "utility process command timed out",
    );
    expect(onDispose).toHaveBeenCalledTimes(1);
    expect(recordDiagnostic).toHaveBeenCalledWith({
      kind: "utility_error",
      detail: expect.objectContaining({
        failure: "command_timeout",
        command: "pause",
      }),
    });
  });

  it("terminates the child after three missed heartbeats", async () => {
    vi.useFakeTimers();
    const { child, logger, onDispose, recordDiagnostic } =
      await connectRuntime();

    await vi.advanceTimersByTimeAsync(60_000);

    const pingCalls = child.postMessage.mock.calls.filter(
      ([message]) => message.type === "ping",
    );
    expect(pingCalls).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        eventName: "utility.heartbeat.missed",
        missedHeartbeats: 3,
      }),
      "utility process heartbeat missed",
    );
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(onDispose).toHaveBeenCalledTimes(1);
    expect(recordDiagnostic).toHaveBeenCalledWith({
      kind: "utility_error",
      detail: expect.objectContaining({
        failure: "heartbeat_timeout",
        missedHeartbeats: 3,
      }),
    });
  });

  it("records utility exits before disposal", async () => {
    const { runtime, recordDiagnostic, onDispose } = await connectRuntime();

    runtime.handleExit(9);

    expect(recordDiagnostic).toHaveBeenCalledWith({
      kind: "utility_exit",
      severity: "ERROR",
      detail: { exitCode: 9 },
    });
    expect(onDispose).toHaveBeenCalledTimes(1);
  });
});
