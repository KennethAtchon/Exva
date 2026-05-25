import { describe, expect, it, vi } from "vitest";
import { ShutdownCoordinator } from "../shutdown-coordinator";

describe("ShutdownCoordinator", () => {
  it("stops all active runtimes before closing the database", async () => {
    const stopSession = vi.fn(async () => undefined);
    const shutdownAll = vi.fn(async () => undefined);
    const closeDb = vi.fn();
    const coordinator = new ShutdownCoordinator(
      {
        listActive: () => [
          { sessionId: "session-a" },
          { sessionId: "session-b" },
        ],
        stopSession,
        shutdownAll,
      } as never,
      {
        info: vi.fn(),
        error: vi.fn(),
      } as never,
      closeDb,
    );

    await coordinator.shutdown();

    expect(stopSession).toHaveBeenCalledTimes(2);
    expect(stopSession).toHaveBeenNthCalledWith(1, "session-a");
    expect(stopSession).toHaveBeenNthCalledWith(2, "session-b");
    expect(shutdownAll).toHaveBeenCalledTimes(1);
    expect(closeDb).toHaveBeenCalledTimes(1);
  });

  it("is idempotent", async () => {
    const stopSession = vi.fn(async () => undefined);
    const closeDb = vi.fn();
    const coordinator = new ShutdownCoordinator(
      {
        listActive: () => [{ sessionId: "session-a" }],
        stopSession,
      } as never,
      {
        info: vi.fn(),
        error: vi.fn(),
      } as never,
      closeDb,
    );

    await coordinator.shutdown();
    await coordinator.shutdown();

    expect(stopSession).toHaveBeenCalledTimes(1);
    expect(closeDb).toHaveBeenCalledTimes(1);
  });
});
