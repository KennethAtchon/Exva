import { describe, expect, it, vi } from "vitest";
import { LiveReadinessService } from "../live-readiness-service";

function makeService(overrides: {
  executionMode?: string;
  assignedIds?: string[];
  brokerMode?: string;
  connectionOk?: boolean;
  acknowledgedAt?: string | null;
} = {}) {
  const {
    executionMode = "live_allowed",
    assignedIds = ["broker-1"],
    brokerMode = "live",
    connectionOk = true,
    acknowledgedAt = "2026-01-01T00:00:00Z",
  } = overrides;

  const mockClient = {
    db: {
      update: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      run: vi.fn(),
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      get: vi.fn().mockReturnValue({ liveReadinessAcknowledgedAt: acknowledgedAt }),
    },
  } as never;

  const sessionRepo = {
    requireById: vi.fn().mockReturnValue({ id: "s1", executionMode }),
  } as never;

  const brokerAccountsRepo = {
    find: vi.fn().mockReturnValue({ id: "broker-1", mode: brokerMode }),
  } as never;

  const sessionBrokerAssignmentsRepo = {
    listBrokerAccountIds: vi.fn().mockReturnValue(assignedIds),
  } as never;

  const brokerRegistry = {
    get: vi.fn().mockResolvedValue({
      testConnection: vi.fn().mockResolvedValue({ ok: connectionOk, message: connectionOk ? "ok" : "failed" }),
    }),
  } as never;

  return new LiveReadinessService(
    mockClient,
    sessionRepo,
    brokerAccountsRepo,
    sessionBrokerAssignmentsRepo,
    brokerRegistry,
  );
}

describe("LiveReadinessService.check", () => {
  it("returns readyToStart=true when all checks pass", async () => {
    const svc = makeService();
    const report = await svc.check("s1");
    expect(report.readyToStart).toBe(true);
    expect(report.allChecksPassed).toBe(true);
  });

  it("fails when execution_mode is not live_allowed", async () => {
    const svc = makeService({ executionMode: "paper_only" });
    const report = await svc.check("s1");
    expect(report.readyToStart).toBe(false);
    const failed = report.checks.find((c) => c.name === "execution_mode");
    expect(failed?.passed).toBe(false);
  });

  it("fails when no broker is assigned", async () => {
    const svc = makeService({ assignedIds: [] });
    const report = await svc.check("s1");
    expect(report.readyToStart).toBe(false);
    const failed = report.checks.find((c) => c.name === "broker_assigned");
    expect(failed?.passed).toBe(false);
  });

  it("fails when broker is in paper mode", async () => {
    const svc = makeService({ brokerMode: "paper" });
    const report = await svc.check("s1");
    expect(report.readyToStart).toBe(false);
    const failed = report.checks.find((c) => c.name === "broker_live_mode");
    expect(failed?.passed).toBe(false);
  });

  it("fails when broker connection test fails", async () => {
    const svc = makeService({ connectionOk: false });
    const report = await svc.check("s1");
    expect(report.readyToStart).toBe(false);
    const failed = report.checks.find((c) => c.name === "broker_connected");
    expect(failed?.passed).toBe(false);
  });

  it("fails when no acknowledgement has been recorded", async () => {
    const svc = makeService({ acknowledgedAt: null });
    const report = await svc.check("s1");
    expect(report.readyToStart).toBe(false);
    const ackCheck = report.checks.find((c) => c.name === "user_acknowledged");
    expect(ackCheck?.passed).toBe(false);
    expect(ackCheck?.requiresAck).toBe(true);
  });

  it("includes acknowledgedAt in report when acknowledged", async () => {
    const svc = makeService({ acknowledgedAt: "2026-01-01T00:00:00Z" });
    const report = await svc.check("s1");
    expect(report.acknowledgedAt).toBe("2026-01-01T00:00:00Z");
  });
});
