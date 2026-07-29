import { describe, expect, it, vi } from "vitest";
import { SessionService } from "../session-service";

describe("SessionService prepareForActivation on resume", () => {
  it("runs live readiness + preflight on resume (P1-5)", async () => {
    const order: string[] = [];
    const check = vi.fn(async () => ({
      readyToStart: true,
      checks: [{ name: "ok", passed: true }],
    }));
    const provisionHistory = vi.fn(async () => {
      order.push("provision");
    });
    const preflight = vi.fn(async () => {
      order.push("preflight");
      return { ok: true as const };
    });
    const resumeSession = vi.fn(async () => {
      order.push("resume");
    });
    const insert = vi.fn();

    const service = new SessionService({
      sessionRepo: {
        requireById: () => ({
          id: "session-1",
          status: "paused",
          executionMode: "live_allowed",
        }),
        getStatus: () => "active",
        getFocusedSessionId: () => "session-1",
      },
      tradesRepo: { listOpenAndPending: () => [] },
      eventsRepo: { insert },
      runtimeManager: { resumeSession },
      liveReadiness: { check },
      provisionHistory,
      preflight,
      orchestratorDeps: {},
      clearOrderHalt: vi.fn(),
    } as never);

    await expect(service.resume("session-1")).resolves.toBe("active");
    expect(check).toHaveBeenCalledWith("session-1");
    expect(provisionHistory).toHaveBeenCalledWith(
      expect.objectContaining({ id: "session-1" }),
    );
    expect(preflight).toHaveBeenCalled();
    expect(resumeSession).toHaveBeenCalledWith("session-1");
    expect(order).toEqual(["provision", "preflight", "resume"]);
  });

  it("blocks resume when preflight fails", async () => {
    const service = new SessionService({
      sessionRepo: {
        requireById: () => ({
          id: "session-1",
          status: "paused",
          executionMode: "paper_only",
        }),
        getStatus: () => "paused",
        getFocusedSessionId: () => "session-1",
      },
      tradesRepo: { listOpenAndPending: () => [] },
      eventsRepo: { insert: vi.fn() },
      runtimeManager: { resumeSession: vi.fn(async () => undefined) },
      liveReadiness: {
        check: vi.fn(async () => ({ readyToStart: true, checks: [] })),
      },
      preflight: vi.fn(async () => ({
        ok: false as const,
        check: "broker",
        code: "VALIDATION_FAILED",
        message: "no broker",
      })),
      orchestratorDeps: {},
    } as never);

    await expect(service.resume("session-1")).rejects.toThrow(/Preflight/);
  });
});
