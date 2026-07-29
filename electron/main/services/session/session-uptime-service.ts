import { and, eq } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import { sessionUptimeDays } from "../../db/schema";

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
    const dayKey = now.toISOString().slice(0, 10);
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
          firstEligibleScanAt: now.toISOString(),
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

  coverage(
    sessionId: string,
    dayKey?: string,
  ): {
    dayKey: string;
    liveMinutes: number;
    eligibleWindowMinutes: number;
    coveragePct: number;
    sufficient: boolean;
  } | null {
    const key = dayKey ?? this.now().toISOString().slice(0, 10);
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
}

/** Regular equity session length in minutes (6.5h); weekends = 0. */
function expectedEligibleMinutes(dayKey: string): number {
  const d = new Date(`${dayKey}T12:00:00.000Z`);
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return 0;
  return 6.5 * 60;
}
