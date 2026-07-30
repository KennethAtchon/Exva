import { describe, expect, it } from "vitest";
import { SessionUptimeService } from "../session-uptime-service";
import {
  dayKeyEt,
  expectedEligibleMinutes,
  marketOpenAt,
  minutesLateAtOpen,
} from "../../scheduling/schedule-grid";

describe("SessionUptimeService", () => {
  it("records first eligible scan and minutes late at open", () => {
    const dayKey = "2026-07-29";
    const open = marketOpenAt(dayKey);
    const firstScan = new Date(open.getTime() + 4 * 60_000);
    const rows = new Map<string, Record<string, unknown>>();

    const db = {
      db: {
        select: () => ({
          from: () => ({
            where: () => ({
              get: () => rows.get(`${dayKey}:s1`),
            }),
          }),
        }),
        insert: () => ({
          values: (v: Record<string, unknown>) => ({
            run: () => {
              rows.set(`${v.dayKey}:${v.sessionId}`, v);
            },
          }),
        }),
        update: () => ({
          set: (v: Record<string, unknown>) => ({
            where: () => ({
              run: () => {
                const existing = rows.get(`${dayKey}:s1`);
                if (existing) Object.assign(existing, v);
              },
            }),
          }),
        }),
      },
    };

    const svc = new SessionUptimeService(db as never, () => firstScan);
    svc.recordEligibleScan("s1", firstScan);
    const row = rows.get(`${dayKey}:s1`);
    expect(row?.firstEligibleScanAt).toBe(firstScan.toISOString());
    expect(row?.minutesLateAtOpen).toBe(4);
  });

  it("increments unplanned stops during eligible window", () => {
    const now = new Date("2026-07-29T15:00:00.000Z");
    const dayKey = dayKeyEt(now);
    const rows = new Map<string, Record<string, unknown>>();
    rows.set(`${dayKey}:s1`, {
      id: "u1",
      sessionId: "s1",
      dayKey,
      eligibleWindowMinutes: expectedEligibleMinutes(dayKey),
      liveMinutes: 10,
      coveragePct: 50,
      firstEligibleScanAt: null,
      minutesLateAtOpen: null,
      unplannedStops: 0,
    });

    const db = {
      db: {
        select: () => ({
          from: () => ({
            where: () => ({
              get: () => rows.get(`${dayKey}:s1`),
            }),
          }),
        }),
        insert: () => ({ values: () => ({ run: () => {} }) }),
        update: () => ({
          set: (v: Record<string, unknown>) => ({
            where: () => ({
              run: () => {
                const existing = rows.get(`${dayKey}:s1`);
                if (existing) Object.assign(existing, v);
              },
            }),
          }),
        }),
      },
    };

    const svc = new SessionUptimeService(db as never, () => now);
    svc.recordUnplannedStop("s1");
    expect(rows.get(`${dayKey}:s1`)?.unplannedStops).toBe(1);
  });
});

describe("minutesLateAtOpen", () => {
  it("returns zero when scan is before open", () => {
    const dayKey = "2026-07-29";
    const open = marketOpenAt(dayKey);
    expect(minutesLateAtOpen(new Date(open.getTime() - 60_000), dayKey)).toBe(0);
  });
});
