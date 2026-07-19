import { desc, eq, and } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import { sessionExecutionSteps } from "../../db/schema";
import type { EventBus } from "../infra/event-bus";
import type { SessionInputSubscriptionRepo } from "../session-inputs/session-input-subscription-repo";
import type { SourceDefinitionRepo } from "../signals/source-definition-repo";
import type { SignalSourcesRepo } from "../signals/repos/signal-sources-repo";
import type { SignalSourceRegistry } from "../signals/signal-source-registry";
import type { SessionActivityRepo } from "../../db/repositories/sessions/session-activity-repo";
import type {
  SessionActivityCondition,
  SessionActivityConditionKind,
  SessionActivitySeverity,
  SessionActivitySnapshot,
} from "@electron/shared/domain/session-activity";
import { createLogger } from "../infra/log";

const logger = createLogger("session-activity-tracker");

const SWEEP_INTERVAL_MS = 60_000;
/** Consecutive no-trade selector cycles before flagging selector_rejecting_all. */
const SELECTOR_REJECT_THRESHOLD = 3;

export interface SessionActivityTrackerDeps {
  activityRepo: SessionActivityRepo;
  subscriptionRepo: SessionInputSubscriptionRepo;
  sourceDefinitionRepo: SourceDefinitionRepo;
  signalSourcesRepo: SignalSourcesRepo;
  signalRegistry: Pick<SignalSourceRegistry, "status">;
  sessionRepo: { list(input?: { includeArchived?: boolean }): Array<{ id: string; status: string }> };
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
