import { describe, expect, it, vi } from "vitest";
import { SessionStartupRecoveryService } from "../session-startup-recovery-service";

describe("SessionStartupRecoveryService", () => {
  it("includes stopped sessions that still have open trades", () => {
    const service = createService({
      sessionsByStatus: {
        active: [{ id: "active-1" }],
        paused: [{ id: "paused-1" }],
        stopped: [{ id: "stopped-open", openTradeCount: 2 }],
      },
    });

    const recoverable = service.collectRecoverableSessions();
    expect(recoverable.map((entry) => entry.sessionId)).toEqual([
      "active-1",
      "paused-1",
      "stopped-open",
    ]);
    expect(
      recoverable.find((entry) => entry.sessionId === "stopped-open"),
    ).toMatchObject({
      priorStatus: "stopped",
      demoteToPaused: true,
      safetyRecovery: true,
    });
  });

  it("repairs stale running execution steps", () => {
    const upsert = vi.fn();
    const service = createService({
      sessionsByStatus: { active: [], paused: [], stopped: [] },
      latestCycleState: {
        cycleId: "cycle-1",
        steps: [
          {
            stage: "selector",
            status: "running",
            attempt: 1,
            startedAt: "2026-05-24T00:00:00.000Z",
          },
        ],
      },
      sessionExecutionStepsRepo: { upsert },
    });

    const repaired = service.repairStaleRunningSteps("session-1");
    expect(repaired).toBe(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "process_killed",
      }),
    );
  });

  it("releases orphaned capital reservations", () => {
    const releaseByApproval = vi.fn();
    const releaseOnFailure = vi.fn();
    const service = createService({
      sessionsByStatus: { active: [], paused: [], stopped: [] },
      activeReservations: [
        { approvalId: "approval-1", tradeId: null },
        { approvalId: null, tradeId: "trade-open" },
      ],
      openTrades: [{ id: "trade-open", status: "open" }],
      pendingApprovals: [],
      capitalReservation: { releaseByApproval, releaseOnFailure },
    });

    const released = service.auditCapitalReservations("session-1");
    expect(released).toBe(1);
    expect(releaseByApproval).toHaveBeenCalledWith("approval-1");
    expect(releaseOnFailure).not.toHaveBeenCalled();
  });

  it("includes monitoring_only sessions without demoting them", () => {
    const service = createService({
      sessionsByStatus: {
        active: [],
        paused: [],
        stopped: [],
        monitoring_only: [{ id: "draining-1" }],
      },
    });

    const recoverable = service.collectRecoverableSessions();
    expect(recoverable).toContainEqual({
      sessionId: "draining-1",
      priorStatus: "monitoring_only",
      demoteToPaused: false,
      safetyRecovery: false,
    });
  });
});

function createService(input: {
  sessionsByStatus: Partial<
    Record<
      "active" | "paused" | "stopped" | "monitoring_only",
      Array<{ id: string; openTradeCount?: number }>
    >
  >;
  latestCycleState?: {
    cycleId: string;
    steps: Array<{
      stage: string;
      status: string;
      attempt: number;
      startedAt: string;
    }>;
  };
  sessionExecutionStepsRepo?: { upsert: ReturnType<typeof vi.fn> };
  activeReservations?: Array<{ approvalId: string | null; tradeId: string | null }>;
  openTrades?: Array<{ id: string; status: string }>;
  pendingApprovals?: Array<{ id: string; sessionId: string }>;
  capitalReservation?: {
    releaseByApproval: ReturnType<typeof vi.fn>;
    releaseOnFailure: ReturnType<typeof vi.fn>;
  };
}) {
  const openTradeCounts = new Map<string, number>();
  for (const group of Object.values(input.sessionsByStatus)) {
    for (const session of group) {
      openTradeCounts.set(session.id, session.openTradeCount ?? 0);
    }
  }

  return new SessionStartupRecoveryService({
    sessionRepo: {
      listByStatuses: (
        statuses: Array<"active" | "paused" | "stopped" | "monitoring_only">,
      ) =>
        statuses.flatMap((status) =>
          (input.sessionsByStatus[status] ?? []).map((session) => ({
            id: session.id,
            status,
          })),
        ),
      setStatus: vi.fn(),
    },
    tradesRepo: {
      listOpenAndPending: (sessionId: string) => {
        if (input.openTrades) {
          return input.openTrades;
        }
        const count = openTradeCounts.get(sessionId) ?? 0;
        return Array.from({ length: count }, (_, index) => ({
          id: `${sessionId}-trade-${index}`,
          status: "open",
        }));
      },
      updateStatus: vi.fn(),
    },
    tradeApprovalsRepo: {
      listPending: () => input.pendingApprovals ?? [],
    },
    sessionExecutionStepsRepo: {
      getLatestCycleState: () =>
        input.latestCycleState ?? { cycleId: null, steps: [] },
      upsert: input.sessionExecutionStepsRepo?.upsert ?? vi.fn(),
    },
    capitalReservationsRepo: {},
    capitalReservation: {
      releaseOnClose: vi.fn(),
      listActiveBySession: () => input.activeReservations ?? [],
      releaseByApproval:
        input.capitalReservation?.releaseByApproval ?? vi.fn(),
      releaseOnFailure:
        input.capitalReservation?.releaseOnFailure ?? vi.fn(),
    },
    brokerRegistry: {
      get: vi.fn(),
    },
    eventsRepo: {
      insert: vi.fn(),
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  } as never);
}
