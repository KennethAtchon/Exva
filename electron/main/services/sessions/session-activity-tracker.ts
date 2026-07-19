import { desc, eq, and } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import { sessionExecutionSteps, sessionSignalDeliveries } from "../../db/schema";
import type { EventBus } from "../infra/event-bus";
import type { SessionInputSubscriptionRepo } from "../session-inputs/session-input-subscription-repo";
import type { SourceDefinitionRepo } from "../signals/source-definition-repo";
import type { SignalSourcesRepo } from "../signals/repos/signal-sources-repo";
import type { SignalSourceRegistry } from "../signals/signal-source-registry";
import type { MarketCalendarRegistry } from "../scheduling/market-calendar-registry";
import type { SessionActivityRepo } from "../../db/repositories/sessions/session-activity-repo";
import type {
  SessionActivityCondition,
  SessionActivityConditionKind,
  SessionActivitySeverity,
  SessionActivitySnapshot,
} from "@electron/shared/domain/session-activity";
import { createLogger } from "../infra/log";

const logger = createLogger("session-activity-tracker");

const NEXT_OPEN_STEP_MS = 15 * 60 * 1000;
const NEXT_OPEN_MAX_STEPS = 8 * 24 * 4; // 8 days of 15-min steps

/** Step forward until every given calendar reports open, or give up after 8 days. */
function findNextOpen(
  calendars: Array<{ isOpen(now?: Date): boolean }>,
  from: Date,
): Date | null {
  let candidate = new Date(from.getTime() + NEXT_OPEN_STEP_MS);
  for (let i = 0; i < NEXT_OPEN_MAX_STEPS; i++) {
    if (calendars.every((cal) => cal.isOpen(candidate))) return candidate;
    candidate = new Date(candidate.getTime() + NEXT_OPEN_STEP_MS);
  }
  return null;
}

const SWEEP_INTERVAL_MS = 60_000;
/** Consecutive no-trade selector cycles before flagging selector_rejecting_all. */
const SELECTOR_REJECT_THRESHOLD = 3;
/** Grace period after session start before "nothing has happened" is worth flagging. */
const NO_SIGNAL_STALE_GRACE_MS = 30 * 60 * 1000;

export interface SessionActivityTrackerDeps {
  activityRepo: SessionActivityRepo;
  subscriptionRepo: SessionInputSubscriptionRepo;
  sourceDefinitionRepo: SourceDefinitionRepo;
  signalSourcesRepo: SignalSourcesRepo;
  signalRegistry: Pick<SignalSourceRegistry, "status">;
  calendarRegistry: Pick<MarketCalendarRegistry, "get">;
  sessionRepo: {
    list(input?: { includeArchived?: boolean }): Array<{
      id: string;
      status: string;
      createdAt: string;
    }>;
  };
  db: DbClient;
  bus: EventBus;
  /** Called on first occurrence of a WARN/ERROR condition. */
  notify?: (sessionId: string, condition: SessionActivityCondition) => void;
}

/**
 * Pure consumer of the event bus + periodic DB sweep. Never writes into the
 * execution path — a bug here must never affect trading.
 * See docs/feature-requests/session-activity-indicator.md.
 */
export class SessionActivityTracker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubs: Array<() => void> = [];

  constructor(private readonly deps: SessionActivityTrackerDeps) {}

  start(): () => void {
    this.unsubs = [
      this.deps.bus.on("step:started", (p) =>
        this.setActivity(p.sessionId, `Running ${p.stage} (cycle ${p.cycleId})`),
      ),
      this.deps.bus.on("step:succeeded", (p) =>
        this.setActivity(p.sessionId, `Waiting for next cycle (last: ${p.stage} ok)`),
      ),
      this.deps.bus.on("step:failed", (p) =>
        this.setActivity(
          p.sessionId,
          `${p.stage} failed: ${p.errorMessage}`,
        ),
      ),
      this.deps.bus.on("session_status_changed", (p) => {
        if (p.status !== "active") this.setActivity(p.sessionId, `Session ${p.status}`);
      }),
    ];

    this.timer = setInterval(() => {
      void this.sweep().catch((err) =>
        logger.error({ err }, "session-activity sweep failed"),
      );
    }, SWEEP_INTERVAL_MS);
    void this.sweep().catch((err) =>
      logger.error({ err }, "session-activity initial sweep failed"),
    );

    return () => this.stop();
  }

  stop(): void {
    this.unsubs.forEach((unsub) => unsub());
    this.unsubs = [];
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Report a detected condition (idempotent — merges by kind). */
  reportCondition(
    sessionId: string,
    kind: SessionActivityConditionKind,
    severity: SessionActivitySeverity,
    message: string,
  ): void {
    const now = new Date().toISOString();
    const current = this.deps.activityRepo.get(sessionId);
    const existing = current?.conditions.find((c) => c.kind === kind);
    const isFirstOccurrence = !existing;

    const nextCondition: SessionActivityCondition = existing
      ? { ...existing, severity, message, count: existing.count + 1 }
      : { kind, severity, message, since: now, count: 1 };

    const conditions = [
      ...(current?.conditions.filter((c) => c.kind !== kind) ?? []),
      nextCondition,
    ];

    const snapshot = this.deps.activityRepo.set({
      sessionId,
      activity: current?.activity ?? message,
      conditions,
    });
    this.deps.bus.emit("session_activity_changed", snapshot);

    if (isFirstOccurrence && (severity === "warn" || severity === "error")) {
      this.deps.notify?.(sessionId, nextCondition);
    }
  }

  clearCondition(sessionId: string, kind: SessionActivityConditionKind): void {
    const current = this.deps.activityRepo.get(sessionId);
    if (!current || !current.conditions.some((c) => c.kind === kind)) return;
    const snapshot = this.deps.activityRepo.set({
      sessionId,
      activity: current.activity,
      conditions: current.conditions.filter((c) => c.kind !== kind),
    });
    this.deps.bus.emit("session_activity_changed", snapshot);
  }

  private setActivity(sessionId: string, activity: string): void {
    const current = this.deps.activityRepo.get(sessionId);
    const snapshot = this.deps.activityRepo.set({
      sessionId,
      activity,
      conditions: current?.conditions ?? [],
    });
    this.deps.bus.emit("session_activity_changed", snapshot);
  }

  /** Exposed for tests; production callers rely on the internal 60s timer. */
  async runSweepNow(): Promise<void> {
    return this.sweep();
  }

  private async sweep(): Promise<void> {
    const sessions = this.deps.sessionRepo.list().filter((s) => s.status === "active");
    for (const session of sessions) {
      this.sweepInputSourceDead(session.id);
      this.sweepSelectorRejectingAll(session.id);
      this.sweepNoSignalStale(session);
      this.sweepMarketClosed(session.id);
    }
  }

  /**
   * Non-alarming info condition: a scheduled-scan session sitting idle
   * because the market it trades is closed, not because anything is
   * broken (acceptance criterion 2, docs/feature-requests/
   * session-activity-indicator.md). schedule-coordinator.ts already skips
   * ticks silently while closed — this just makes that visible.
   */
  private sweepMarketClosed(sessionId: string): void {
    const scheduledSubs = this.deps.subscriptionRepo
      .listEnabledBySession(sessionId)
      .filter((s) => s.mode === "scheduled_scan");

    if (scheduledSubs.length === 0) {
      this.clearCondition(sessionId, "market_closed");
      return;
    }

    const now = new Date();
    const closedCalendars = scheduledSubs
      .map((sub) => this.deps.calendarRegistry.get(sub.marketCalendarId))
      .filter((cal): cal is NonNullable<typeof cal> => cal !== null);

    const allClosed =
      closedCalendars.length > 0 &&
      closedCalendars.every((cal) => !cal.isOpen(now));

    if (!allClosed) {
      this.clearCondition(sessionId, "market_closed");
      return;
    }

    const nextOpenAt = findNextOpen(closedCalendars, now);
    const when = nextOpenAt
      ? new Intl.DateTimeFormat("en-US", {
          timeZone: "America/New_York",
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
          timeZoneName: "short",
        }).format(nextOpenAt)
      : "next session";
    this.reportCondition(
      sessionId,
      "market_closed",
      "info",
      `Market closed — resumes ${when}.`,
    );
  }

  /**
   * Secondary problem 2: no zero-activity watchdog. A session can sit
   * `active` for hours with zero execution cycles and zero signals
   * delivered and nothing ever says so. Absence of activity is itself the
   * signal here — an event stream structurally can't emit "nothing happened".
   */
  private sweepNoSignalStale(session: { id: string; createdAt: string }): void {
    const ageMs = Date.now() - Date.parse(session.createdAt);
    if (!Number.isFinite(ageMs) || ageMs < NO_SIGNAL_STALE_GRACE_MS) {
      this.clearCondition(session.id, "no_signal_stale");
      return;
    }

    const stepCount = this.deps.db.db
      .select()
      .from(sessionExecutionSteps)
      .where(eq(sessionExecutionSteps.sessionId, session.id))
      .limit(1)
      .all().length;
    const deliveryCount = this.deps.db.db
      .select()
      .from(sessionSignalDeliveries)
      .where(eq(sessionSignalDeliveries.sessionId, session.id))
      .limit(1)
      .all().length;

    if (stepCount === 0 && deliveryCount === 0) {
      const hours = Math.floor(ageMs / (60 * 60 * 1000));
      this.reportCondition(
        session.id,
        "no_signal_stale",
        "warn",
        `Session has consumed no input and run no execution cycle in ${hours >= 1 ? `${hours}h` : "30m"} since start.`,
      );
    } else {
      this.clearCondition(session.id, "no_signal_stale");
    }
  }

  /** Bug 2: event_source subscription whose backing live poller isn't running. */
  private sweepInputSourceDead(sessionId: string): void {
    const subscriptions = this.deps.subscriptionRepo
      .listEnabledBySession(sessionId)
      .filter((s) => s.mode === "event_source");

    let dead = false;
    for (const sub of subscriptions) {
      const definition = this.deps.sourceDefinitionRepo.get(sub.sourceDefinitionId);
      if (!definition) continue;
      const backingSources = this.deps.signalSourcesRepo
        .list()
        .filter((source) => source.type === definition.kind);
      const hasRunningBackingSource = backingSources.some(
        (source) => this.deps.signalRegistry.status(source.id)?.status === "running",
      );
      if (!hasRunningBackingSource) dead = true;
    }

    if (dead) {
      this.reportCondition(
        sessionId,
        "input_source_dead",
        "error",
        "Subscribed to an event source with no running backing poller — this session can never receive a signal.",
      );
    } else {
      this.clearCondition(sessionId, "input_source_dead");
    }
  }

  /** Bug 4 / secondary problem: K consecutive no-trade selector cycles. */
  private sweepSelectorRejectingAll(sessionId: string): void {
    const rows = this.deps.db.db
      .select()
      .from(sessionExecutionSteps)
      .where(
        and(
          eq(sessionExecutionSteps.sessionId, sessionId),
          eq(sessionExecutionSteps.stage, "selector"),
          eq(sessionExecutionSteps.status, "succeeded"),
        ),
      )
      .orderBy(desc(sessionExecutionSteps.createdAt))
      .limit(SELECTOR_REJECT_THRESHOLD)
      .all();

    const allNoTrade =
      rows.length >= SELECTOR_REJECT_THRESHOLD &&
      rows.every((row) => row.outcome === "no_trade");

    if (allNoTrade) {
      this.reportCondition(
        sessionId,
        "selector_rejecting_all",
        "warn",
        `Last ${SELECTOR_REJECT_THRESHOLD} selector cycles produced no trade candidates.`,
      );
    } else {
      this.clearCondition(sessionId, "selector_rejecting_all");
    }
  }

  getSnapshot(sessionId: string): SessionActivitySnapshot | null {
    return this.deps.activityRepo.get(sessionId);
  }

  listSnapshots(): SessionActivitySnapshot[] {
    return this.deps.activityRepo.list();
  }
}
