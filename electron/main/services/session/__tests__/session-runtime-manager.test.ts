import { describe, expect, it, vi } from "vitest";
import type { Trade } from "@/lib/types";
import { SessionRuntimeManager } from "../session-runtime-manager";

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
});
