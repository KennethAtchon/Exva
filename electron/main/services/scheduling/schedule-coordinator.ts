import { eq } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import { scheduleRuntimeStates } from "../../db/schema";
import type { MarketSignal } from "@electron/shared/domain/market-signal";
import { cadenceToMs } from "@electron/shared/domain/experience-inputs/cadence";
import type { MarketCalendarRegistry } from "./market-calendar-registry";
import type { ScheduledRuntimePlan } from "./session-input-runtime-planner";
import type { ScheduledStrategyExecutor } from "./scheduled-strategy-executor";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CoordinatorTelemetry {
  groupKey: string;
  nextRunAt: string | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastSuccessAt: string | null;
  lastDurationMs: number | null;
  consecutiveFailures: number;
  lastError: string | null;
  instrumentCount: number;
  subscriptionIds: string[];
  running: boolean;
}

/**
 * Called by the coordinator after a scan group fires and produces signals.
 * Implementors fan the signals out to subscribers (e.g. via SignalBus).
 */
export type ScheduledSignalEmitFn = (
  signals: MarketSignal[],
  groupKey: string,
  subscriptions: Array<{ sessionId: string; subscriptionId: string }>,
) => Promise<void>;

/**
 * Resolves subscription IDs to `{sessionId, subscriptionId}` pairs.
 * The coordinator calls this just before emitting to determine the fanout set.
 */
export type ResolveScheduledFanoutFn = (
  subscriptionIds: string[],
) => Array<{ sessionId: string; subscriptionId: string }>;

export interface ScheduleCoordinatorDeps {
  db: DbClient;
  executor: ScheduledStrategyExecutor;
  calendarRegistry: MarketCalendarRegistry;
  emitSignals: ScheduledSignalEmitFn;
  resolveScheduledFanout: ResolveScheduledFanoutFn;
}

// ---------------------------------------------------------------------------
// Internal group state
// ---------------------------------------------------------------------------

interface GroupEntry {
  plan: ScheduledRuntimePlan;
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  consecutiveFailures: number;
  lastError: string | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastSuccessAt: string | null;
  lastDurationMs: number | null;
  nextRunAt: string | null;
}

// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------

const BASE_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 30 * 60_000;
const JITTER_PCT = 0.05;

/**
 * Owns interval timers keyed by `groupKey`. Manages the full lifecycle:
 *  - `reconcile(plans)` — diff-and-apply: add new groups, update changed
 *    groups, remove dropped groups without stopping the world.
 *  - `start() / stop()` — arm / disarm all timers.
 *  - Overlap prevention — a group that is still executing skips the next tick.
 *  - Exponential backoff — consecutive failures double the delay (capped).
 *  - DB persistence — `schedule_runtime_states` is written after each run.
 */
export class ScheduleCoordinator {
  private readonly groups = new Map<string, GroupEntry>();
  private running = false;

  constructor(private readonly deps: ScheduleCoordinatorDeps) {}

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    for (const entry of this.groups.values()) {
      this.arm(entry);
    }
  }

  stop(): void {
    this.running = false;
    for (const entry of this.groups.values()) {
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Reconcile
  // -------------------------------------------------------------------------

  /**
   * Diff the incoming plan set against the current group map.
   * - New group keys are registered.
   * - Changed group keys (different plan) are re-armed with the new plan.
   * - Removed group keys are stopped and deleted.
   */
  reconcile(plans: ScheduledRuntimePlan[]): void {
    const incoming = new Map(plans.map((p) => [p.groupKey, p]));

    // Add / update
    for (const [groupKey, plan] of incoming) {
      const existing = this.groups.get(groupKey);
      if (!existing) {
        const entry: GroupEntry = {
          plan,
          timer: null,
          running: false,
          consecutiveFailures: 0,
          lastError: null,
          lastStartedAt: null,
          lastFinishedAt: null,
          lastSuccessAt: null,
          lastDurationMs: null,
          nextRunAt: null,
        };
        this.groups.set(groupKey, entry);
        // Restore persisted state (if any).
        this.restoreState(entry);
        if (this.running) this.arm(entry);
      } else {
        // Check if subscription list changed (plan parameters are the same
        // since groupKey is a hash of them, but subscriptionIds can grow).
        existing.plan = plan;
        // If already running, no re-arm needed — it will re-arm on next tick.
      }
    }

    // Remove stale groups
    for (const [groupKey, entry] of this.groups) {
      if (!incoming.has(groupKey)) {
        if (entry.timer) clearTimeout(entry.timer);
        this.groups.delete(groupKey);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Telemetry
  // -------------------------------------------------------------------------

  snapshot(): CoordinatorTelemetry[] {
    return [...this.groups.values()].map((entry) => ({
      groupKey: entry.plan.groupKey,
      nextRunAt: entry.nextRunAt,
      lastStartedAt: entry.lastStartedAt,
      lastFinishedAt: entry.lastFinishedAt,
      lastSuccessAt: entry.lastSuccessAt,
      lastDurationMs: entry.lastDurationMs,
      consecutiveFailures: entry.consecutiveFailures,
      lastError: entry.lastError,
      instrumentCount: entry.plan.subscriptionIds.length,
      subscriptionIds: entry.plan.subscriptionIds,
      running: entry.running,
    }));
  }

  getTelemetry(groupKey: string): CoordinatorTelemetry | null {
    const entry = this.groups.get(groupKey);
    if (!entry) return null;
    return {
      groupKey,
      nextRunAt: entry.nextRunAt,
      lastStartedAt: entry.lastStartedAt,
      lastFinishedAt: entry.lastFinishedAt,
      lastSuccessAt: entry.lastSuccessAt,
      lastDurationMs: entry.lastDurationMs,
      consecutiveFailures: entry.consecutiveFailures,
      lastError: entry.lastError,
      instrumentCount: entry.plan.subscriptionIds.length,
      subscriptionIds: entry.plan.subscriptionIds,
      running: entry.running,
    };
  }

  /** Force an immediate fire for testing / debug. */
  async fireNow(groupKey: string): Promise<CoordinatorTelemetry | null> {
    const entry = this.groups.get(groupKey);
    if (!entry) return null;
    await this.fire(entry);
    return this.getTelemetry(groupKey);
  }

  // -------------------------------------------------------------------------
  // Arming
  // -------------------------------------------------------------------------

  private arm(entry: GroupEntry): void {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }

    let baseMs: number;
    try {
      baseMs = cadenceToMs(entry.plan.cadence);
    } catch {
      // Cron cadences aren't supported yet; skip.
      console.warn(
        `[ScheduleCoordinator] groupKey=${entry.plan.groupKey}: cron cadences are not yet supported, skipping.`,
      );
      return;
    }

    // Apply exponential backoff on repeated failures.
    let delay = baseMs;
    if (entry.consecutiveFailures > 0) {
      const backoff = Math.min(
        BASE_BACKOFF_MS * Math.pow(2, entry.consecutiveFailures - 1),
        MAX_BACKOFF_MS,
      );
      delay = Math.max(delay, backoff);
    }

    // Apply jitter (±JITTER_PCT of delay).
    const jitter = delay * JITTER_PCT * (Math.random() * 2 - 1);
    delay = Math.max(1000, Math.round(delay + jitter));

    entry.nextRunAt = new Date(Date.now() + delay).toISOString();

    entry.timer = setTimeout(() => {
      void this.fire(entry).then(() => {
        if (this.running && this.groups.has(entry.plan.groupKey)) {
          this.arm(entry);
        }
      });
    }, delay);
  }

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------

  private async fire(entry: GroupEntry): Promise<void> {
    // Overlap prevention: skip if the previous run hasn't finished.
    if (entry.running) {
      console.warn(
        `[ScheduleCoordinator] groupKey=${entry.plan.groupKey}: previous run still in progress, skipping tick.`,
      );
      return;
    }

    // Calendar check.
    const { calendarRegistry } = this.deps;
    let calendarOpen = true;
    try {
      const calendar = calendarRegistry.require(entry.plan.marketCalendarId);
      calendarOpen = calendar.isOpen();
    } catch (err) {
      console.warn(
        `[ScheduleCoordinator] groupKey=${entry.plan.groupKey}: calendar lookup failed (${String(err)}), treating as open.`,
      );
    }
    if (!calendarOpen) {
      return;
    }

    entry.running = true;
    entry.lastStartedAt = new Date().toISOString();
    const startMs = Date.now();

    try {
      const signals = await this.deps.executor.execute(entry.plan);

      if (signals.length > 0) {
        const subscriptions = this.deps.resolveScheduledFanout(
          entry.plan.subscriptionIds,
        );
        await this.deps.emitSignals(signals, entry.plan.groupKey, subscriptions);
      }

      const now = new Date().toISOString();
      entry.lastFinishedAt = now;
      entry.lastSuccessAt = now;
      entry.lastDurationMs = Date.now() - startMs;
      entry.consecutiveFailures = 0;
      entry.lastError = null;
    } catch (err) {
      const now = new Date().toISOString();
      entry.lastFinishedAt = now;
      entry.lastDurationMs = Date.now() - startMs;
      entry.consecutiveFailures += 1;
      entry.lastError = err instanceof Error ? err.message : String(err);
      console.error(
        `[ScheduleCoordinator] groupKey=${entry.plan.groupKey}: execution error (failures=${entry.consecutiveFailures}): ${entry.lastError}`,
      );
    } finally {
      entry.running = false;
    }

    this.persistState(entry);
  }

  // -------------------------------------------------------------------------
  // DB persistence
  // -------------------------------------------------------------------------

  private persistState(entry: GroupEntry): void {
    const { db } = this.deps;
    const now = new Date().toISOString();
    const row = {
      groupKey: entry.plan.groupKey,
      nextRunAt: entry.nextRunAt,
      lastStartedAt: entry.lastStartedAt,
      lastFinishedAt: entry.lastFinishedAt,
      lastSuccessAt: entry.lastSuccessAt,
      lastDurationMs: entry.lastDurationMs,
      consecutiveFailures: entry.consecutiveFailures,
      lastError: entry.lastError,
      subscriptionIdsJson: JSON.stringify(entry.plan.subscriptionIds),
      instrumentCount: entry.plan.subscriptionIds.length,
      updatedAt: now,
    };
    db.db
      .insert(scheduleRuntimeStates)
      .values(row)
      .onConflictDoUpdate({
        target: scheduleRuntimeStates.groupKey,
        set: row,
      })
      .run();
  }

  private restoreState(entry: GroupEntry): void {
    const { db } = this.deps;
    const row = db.db
      .select()
      .from(scheduleRuntimeStates)
      .where(eq(scheduleRuntimeStates.groupKey, entry.plan.groupKey))
      .get();
    if (!row) return;
    entry.consecutiveFailures = row.consecutiveFailures;
    entry.lastError = row.lastError;
    entry.lastStartedAt = row.lastStartedAt;
    entry.lastFinishedAt = row.lastFinishedAt;
    entry.lastSuccessAt = row.lastSuccessAt;
    entry.lastDurationMs = row.lastDurationMs;
    entry.nextRunAt = row.nextRunAt;
  }

}
