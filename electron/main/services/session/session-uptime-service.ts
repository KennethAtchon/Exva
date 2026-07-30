import { and, eq } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import { sessionUptimeDays } from "../../db/schema";
import {
  dayKeyEt,
  expectedEligibleMinutes,
  minutesLateAtOpen as computeMinutesLateAtOpen,
} from "../scheduling/schedule-grid";

/**
 * Record trading-day uptime coverage (Solution 08).
 * Conclusions should be refused below 90% coverage.
 */
export class SessionUptimeService {
  constructor(
    private readonly db: DbClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Mark the process as alive for `sessionId` on the current UTC day.
   * `intervalMinutes` is credited as live time since the previous heartbeat.
   */
  heartbeat(sessionId: string, intervalMinutes = 1): void {
    const now = this.now();
    const dayKey = dayKeyEt(now);
    const existing = this.db.db
      .select()
      .from(sessionUptimeDays)
      .where(
        and(
          eq(sessionUptimeDays.sessionId, sessionId),
          eq(sessionUptimeDays.dayKey, dayKey),
        ),
      )
      .get();

    const eligible = expectedEligibleMinutes(dayKey);

    if (!existing) {
      const live = Math.min(intervalMinutes, eligible || intervalMinutes);
      this.db.db
        .insert(sessionUptimeDays)
        .values({
          id: crypto.randomUUID(),
          sessionId,
          dayKey,
          eligibleWindowMinutes: eligible,
          liveMinutes: live,
          coveragePct: eligible > 0 ? (live / eligible) * 100 : 0,
          firstEligibleScanAt: null,
          minutesLateAtOpen: null,
          unplannedStops: 0,
        })
        .run();
      return;
    }

    const liveMinutes = existing.liveMinutes + intervalMinutes;
    const eligibleWindowMinutes =
      existing.eligibleWindowMinutes > 0
        ? existing.eligibleWindowMinutes
        : eligible;
    this.db.db
      .update(sessionUptimeDays)
      .set({
        liveMinutes,
        eligibleWindowMinutes,
        coveragePct:
          eligibleWindowMinutes > 0
            ? (liveMinutes / eligibleWindowMinutes) * 100
            : 0,
      })
      .where(
        and(
          eq(sessionUptimeDays.sessionId, sessionId),
          eq(sessionUptimeDays.dayKey, dayKey),
        ),
      )
      .run();
  }

  /** First eligible scan after open — not the first heartbeat (Solution 08). */
  recordEligibleScan(sessionId: string, at: Date = this.now()): void {
    const dayKey = dayKeyEt(at);
    this.ensureDayRow(sessionId, dayKey);
    const existing = this.db.db
      .select()
      .from(sessionUptimeDays)
      .where(
        and(
          eq(sessionUptimeDays.sessionId, sessionId),
          eq(sessionUptimeDays.dayKey, dayKey),
        ),
      )
      .get();
    if (!existing || existing.firstEligibleScanAt) return;

    const late = computeMinutesLateAtOpen(at, dayKey);
    this.db.db
      .update(sessionUptimeDays)
      .set({
        firstEligibleScanAt: at.toISOString(),
        minutesLateAtOpen: late,
      })
      .where(
        and(
          eq(sessionUptimeDays.sessionId, sessionId),
          eq(sessionUptimeDays.dayKey, dayKey),
        ),
      )
      .run();
  }

  /** Increment when the process exits/crashes during an eligible window. */
  recordUnplannedStop(sessionId: string, at: Date = this.now()): void {
    const dayKey = dayKeyEt(at);
    const eligible = expectedEligibleMinutes(dayKey);
    if (eligible <= 0) return;

    this.ensureDayRow(sessionId, dayKey);
    const existing = this.db.db
      .select()
      .from(sessionUptimeDays)
      .where(
        and(
          eq(sessionUptimeDays.sessionId, sessionId),
          eq(sessionUptimeDays.dayKey, dayKey),
        ),
      )
      .get();
    if (!existing) return;

    this.db.db
      .update(sessionUptimeDays)
      .set({ unplannedStops: existing.unplannedStops + 1 })
      .where(
        and(
          eq(sessionUptimeDays.sessionId, sessionId),
          eq(sessionUptimeDays.dayKey, dayKey),
        ),
      )
      .run();
  }

  coverage(
    sessionId: string,
    dayKey?: string,
  ): {
    dayKey: string;
    liveMinutes: number;
    eligibleWindowMinutes: number;
    coveragePct: number;
    sufficient: boolean;
    firstEligibleScanAt: string | null;
    minutesLateAtOpen: number | null;
    unplannedStops: number;
  } | null {
    const key = dayKey ?? dayKeyEt(this.now());
    const row = this.db.db
      .select()
      .from(sessionUptimeDays)
      .where(
        and(
          eq(sessionUptimeDays.sessionId, sessionId),
          eq(sessionUptimeDays.dayKey, key),
        ),
      )
      .get();
    if (!row) return null;
    return {
      dayKey: key,
      liveMinutes: row.liveMinutes,
      eligibleWindowMinutes: row.eligibleWindowMinutes,
      coveragePct: row.coveragePct,
      sufficient: row.coveragePct >= 90,
      firstEligibleScanAt: row.firstEligibleScanAt,
      minutesLateAtOpen: row.minutesLateAtOpen,
      unplannedStops: row.unplannedStops,
    };
  }

  /** Refuse analytics conclusions when coverage is below 90%. */
  assertSufficientCoverage(sessionId: string, dayKey?: string): void {
    const cov = this.coverage(sessionId, dayKey);
    if (!cov) {
      throw new Error(
        `No uptime coverage recorded for session ${sessionId}; refuse conclusions`,
      );
    }
    if (!cov.sufficient) {
      throw new Error(
        `Uptime coverage ${cov.coveragePct.toFixed(1)}% below 90% for ${cov.dayKey}; refuse conclusions`,
      );
    }
  }

  private ensureDayRow(sessionId: string, dayKey: string): void {
    const existing = this.db.db
      .select()
      .from(sessionUptimeDays)
      .where(
        and(
          eq(sessionUptimeDays.sessionId, sessionId),
          eq(sessionUptimeDays.dayKey, dayKey),
        ),
      )
      .get();
    if (existing) return;

    const eligible = expectedEligibleMinutes(dayKey);
    this.db.db
      .insert(sessionUptimeDays)
      .values({
        id: crypto.randomUUID(),
        sessionId,
        dayKey,
        eligibleWindowMinutes: eligible,
        liveMinutes: 0,
        coveragePct: 0,
        firstEligibleScanAt: null,
        minutesLateAtOpen: null,
        unplannedStops: 0,
      })
      .run();
  }
}
