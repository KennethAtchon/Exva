import { describe, expect, it } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import { scheduleRuntimeStates } from "../../../db/schema";
import { ScanFunnelService } from "../scan-funnel-service";
import type { ScheduleCoordinator } from "../schedule-coordinator";

function insertRuntimeState(
  db: ReturnType<typeof createTestDb>,
  overrides: {
    groupKey: string;
    subscriptionIds: string[];
    summary?: unknown;
    lastError?: string | null;
  },
): void {
  db.db
    .insert(scheduleRuntimeStates)
    .values({
      groupKey: overrides.groupKey,
      nextRunAt: "2026-07-29T15:00:00.000Z",
      lastStartedAt: "2026-07-29T14:45:00.000Z",
      lastFinishedAt: "2026-07-29T14:45:01.000Z",
      lastSuccessAt: null,
      lastDurationMs: 1000,
      consecutiveFailures: 2,
      lastError: overrides.lastError ?? null,
      lastScanSummaryJson: JSON.stringify(overrides.summary ?? {}),
      subscriptionIdsJson: JSON.stringify(overrides.subscriptionIds),
      instrumentCount: overrides.subscriptionIds.length,
      updatedAt: "2026-07-29T14:45:01.000Z",
    })
    .run();
}

const emptyCoordinator = {
  snapshot: () => [],
} as unknown as ScheduleCoordinator;

describe("ScanFunnelService", () => {
  it("reports the first blocked instrument for a starved lane", () => {
    const db = createTestDb();
    insertRuntimeState(db, {
      groupKey: "grp-etf",
      subscriptionIds: ["sub-1"],
      lastError: "All instruments unevaluable: {}",
      summary: {
        signalCount: 0,
        instrumentCount: 2,
        counts: { insufficient_bars: 2 },
        instruments: [
          {
            symbol: "SPY",
            kind: "insufficient_bars",
            barsActual: 21,
            barsRequired: 50,
          },
          { symbol: "QQQ", kind: "insufficient_bars", barsActual: 3 },
        ],
      },
    });

    const service = new ScanFunnelService({
      db,
      coordinator: emptyCoordinator,
      resolveScheduledFanout: (ids) =>
        ids.map((subscriptionId) => ({ sessionId: "sess-1", subscriptionId })),
    });

    const report = service.forSession("sess-1");

    expect(report.noScheduledInputs).toBe(false);
    expect(report.counts).toEqual({ insufficient_bars: 2 });
    expect(report.firstBlocked).toMatchObject({
      symbol: "SPY",
      kind: "insufficient_bars",
      barsActual: 21,
      barsRequired: 50,
      groupKey: "grp-etf",
    });
    expect(report.groups[0]?.allUnevaluable).toBe(true);
    expect(report.groups[0]?.lastError).toContain("All instruments unevaluable");
    // Persisted-only group: no live timer is armed for it.
    expect(report.groups[0]?.armed).toBe(false);
  });

  it("treats a quiet but evaluating lane as unblocked", () => {
    const db = createTestDb();
    insertRuntimeState(db, {
      groupKey: "grp-crypto",
      subscriptionIds: ["sub-2"],
      summary: {
        signalCount: 0,
        instrumentCount: 1,
        counts: { no_setup: 1 },
        instruments: [
          {
            symbol: "BTC-USD",
            kind: "no_setup",
            barsActual: 400,
            barsRequired: 50,
            newestBarTs: "2026-07-29T12:00:00.000Z",
          },
        ],
      },
    });

    const service = new ScanFunnelService({
      db,
      coordinator: emptyCoordinator,
      resolveScheduledFanout: (ids) =>
        ids.map((subscriptionId) => ({ sessionId: "sess-1", subscriptionId })),
    });

    const report = service.forSession("sess-1");

    expect(report.firstBlocked).toBeNull();
    expect(report.groups[0]?.allUnevaluable).toBe(false);
  });

  it("excludes groups that do not fan out to the session", () => {
    const db = createTestDb();
    insertRuntimeState(db, { groupKey: "grp-other", subscriptionIds: ["sub-9"] });

    const service = new ScanFunnelService({
      db,
      coordinator: emptyCoordinator,
      resolveScheduledFanout: (ids) =>
        ids.map((subscriptionId) => ({ sessionId: "someone-else", subscriptionId })),
    });

    expect(service.forSession("sess-1")).toMatchObject({
      groups: [],
      noScheduledInputs: true,
      firstBlocked: null,
    });
  });

  it("survives an unparseable summary instead of throwing", () => {
    const db = createTestDb();
    db.db
      .insert(scheduleRuntimeStates)
      .values({
        groupKey: "grp-bad",
        nextRunAt: null,
        lastStartedAt: null,
        lastFinishedAt: null,
        lastSuccessAt: null,
        lastDurationMs: null,
        consecutiveFailures: 0,
        lastError: null,
        lastScanSummaryJson: "{not json",
        subscriptionIdsJson: JSON.stringify(["sub-3"]),
        instrumentCount: 1,
        updatedAt: "2026-07-29T14:45:01.000Z",
      })
      .run();

    const service = new ScanFunnelService({
      db,
      coordinator: emptyCoordinator,
      resolveScheduledFanout: (ids) =>
        ids.map((subscriptionId) => ({ sessionId: "sess-1", subscriptionId })),
    });

    const report = service.forSession("sess-1");
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0]?.instruments).toEqual([]);
  });
});
