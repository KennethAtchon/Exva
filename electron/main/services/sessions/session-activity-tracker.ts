import { and, desc, eq, sql } from "drizzle-orm";
import type { DbClient } from "../../db/client";
import {
  apiCallLog,
  events,
  scheduleRuntimeStates,
  sessionExecutionSteps,
  sessionSignalDeliveries,
  trades,
} from "../../db/schema";
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
  SessionActivityMonitoringHealth,
  SessionActivitySeverity,
  SessionActivitySnapshot,
  SessionActivityStats,
} from "@electron/shared/domain/session-activity";
import {
  computeSessionActivityAnalytics,
  type SessionActivityAnalytics,
} from "@electron/shared/domain/session-activity-analytics";
import { createLogger } from "../infra/log";

const logger = createLogger("session-activity-tracker");

const NEXT_OPEN_STEP_MS = 15 * 60 * 1000;
const NEXT_OPEN_MAX_STEPS = 8 * 24 * 4; // 8 days of 15-min steps
const SWEEP_INTERVAL_MS = 60_000;
const MONITORING_STALE_MS = 2.5 * 60_000;
/** Consecutive no-trade selector cycles before flagging selector_rejecting_all. */
const SELECTOR_REJECT_THRESHOLD = 3;
/** Grace period after session start before "nothing has happened" is worth flagging. */
const NO_SIGNAL_STALE_GRACE_MS = 30 * 60 * 1000;
const PROVIDER_WINDOW_MS = 15 * 60 * 1000;
const PROVIDER_MIN_CALLS = 5;
const PROVIDER_ERROR_RATE = 0.5;
const CRASH_LOOP_WINDOW_MS = 10 * 60 * 1000;
const CRASH_LOOP_THRESHOLD = 5;
const DEFAULT_AI_SPEND_LIMIT_USD = 25;
const SPEND_NEAR_RATIO = 0.8;

const MAPPED_FAILURE_CODES = new Set([
  "INSTRUMENT_CONFLICT",
  "BROKER_ALLOCATION_EXHAUSTED",
  "SPEND_CAP_EXCEEDED",
]);

const STEP_FAILURE_CONDITIONS: Record<
  string,
  {
    kind: SessionActivityConditionKind;
    severity: SessionActivitySeverity;
    message: (errorMessage: string) => string;
  }
> = {
  INSTRUMENT_CONFLICT: {
    kind: "symbol_locked",
    severity: "info",
    message: (errorMessage) =>
      `Symbol locked by another session's open trade: ${errorMessage}`,
  },
  BROKER_ALLOCATION_EXHAUSTED: {
    kind: "allocation_blocked",
    severity: "warn",
    message: (errorMessage) =>
      `Capital allocation blocked entry: ${errorMessage}`,
  },
  SPEND_CAP_EXCEEDED: {
    kind: "spend_limit_hit",
    severity: "error",
    message: (errorMessage) => `AI spend limit hit: ${errorMessage}`,
  },
};

function parseScheduleSubscriptionIds(json: string | null | undefined): string[] {
  return (JSON.parse(json || "[]") as string[]) ?? [];
}

function isProviderCallError(status: string): boolean {
  const normalized = status.toLowerCase();
  return (
    normalized.includes("error") ||
    normalized.includes("fail") ||
    normalized === "timeout" ||
    normalized.startsWith("5") ||
    normalized.startsWith("4")
  );
}

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

function formatEt(when: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(when);
}

function severityToLogLevel(
  severity: SessionActivitySeverity,
): "INFO" | "WARN" | "ERROR" {
  switch (severity) {
    case "error":
      return "ERROR";
    case "warn":
    case "attention":
      return "WARN";
    default:
      return "INFO";
  }
}

/** Matches orchestrator selector / no-trade skip event messages. */
const SELECTOR_REJECT_MESSAGE_RE =
  /no instruments accepted|Selector rejected|no tradable instruments|No trade (for|decision)/i;

/** Prefer the clause after the first colon (e.g. `ABC: liquidity gate` → `liquidity gate`). */
function reasonAfterColon(segment: string): string {
  const colon = segment.indexOf(":");
  if (colon < 0) return segment;
  return segment.slice(colon + 1).trim() || segment;
}

function extractSelectorRejectReason(message: string): string | null {
  const rejectedParen = message.match(/rejected \(([^)]+)\)/i);
  const firstReject = rejectedParen?.[1]?.split(";")[0]?.trim();
  if (firstReject) return reasonAfterColon(firstReject);

  const noTrade = message.match(/No trade(?: decision)? for [^:]+:\s*(.+)$/i);
  if (noTrade?.[1]) return noTrade[1].trim();

  const dominant = message.match(/dominant reason:\s*(.+)$/i);
  return dominant?.[1]?.trim() ?? null;
}

function dominantString(values: string[]): string | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  let best: string | null = null;
  let bestCount = 0;
  for (const value of values) {
    const count = (counts.get(value) ?? 0) + 1;
    counts.set(value, count);
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

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
  tradeApprovalsRepo?: {
    listPending(): Array<{ sessionId: string; instrumentSymbol: string }>;
  };
  aiSpendLimitUsd?: number;
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
  private lastSweepAt: string | null = null;
  private readonly failureRing = new Map<
    string,
    Array<{ signature: string; atMs: number }>
  >();
  private readonly aiSpendLimitUsd: number;

  constructor(private readonly deps: SessionActivityTrackerDeps) {
    this.aiSpendLimitUsd = deps.aiSpendLimitUsd ?? DEFAULT_AI_SPEND_LIMIT_USD;
  }

  start(): () => void {
    this.unsubs = [
      this.deps.bus.on("step:started", (p) => {
        this.clearConditions(p.sessionId, ["waiting_retry", "degraded"]);
        this.reportCondition(
          p.sessionId,
          "cycle_running",
          "info",
          `Running ${p.stage} (cycle ${p.cycleId.slice(0, 8)}…).`,
        );
        this.setActivity(
          p.sessionId,
          `Running ${p.stage} (cycle ${p.cycleId})`,
        );
      }),
      this.deps.bus.on("step:succeeded", (p) => {
        this.clearConditions(p.sessionId, [
          "cycle_running",
          "waiting_retry",
          "symbol_locked",
          "allocation_blocked",
          "degraded",
        ]);
        this.setActivity(
          p.sessionId,
          `Waiting for next cycle (last: ${p.stage} ok)`,
        );
      }),
      this.deps.bus.on("step:failed", (p) => {
        this.clearCondition(p.sessionId, "cycle_running");
        this.handleStepFailed(p);
        this.setActivity(
          p.sessionId,
          `${p.stage} failed: ${p.errorMessage}`,
        );
      }),
      this.deps.bus.on("step:retrying", (p) => {
        this.clearCondition(p.sessionId, "cycle_running");
        const when = formatEt(new Date(p.nextRetryAt));
        this.reportCondition(
          p.sessionId,
          "waiting_retry",
          "info",
          `Re-evaluating ${p.stage} after retry — next attempt ${when}.`,
        );
        this.setActivity(
          p.sessionId,
          `Waiting to retry ${p.stage} at ${when}`,
        );
      }),
      this.deps.bus.on("approval_required", (p) => {
        if (!p.session_id) return;
        this.reportCondition(
          p.session_id,
          "awaiting_approval",
          "attention",
          `Awaiting approval for ${p.instrumentSymbol}.`,
          {
            evidenceEventId: this.findEvidenceEventId(p.session_id, "approval"),
          },
        );
      }),
      this.deps.bus.on("session_status_changed", (p) => {
        if (p.status === "active") {
          // Launch-gate: surface dead input sources immediately on start,
          // not only on the next 60s sweep.
          this.setActivity(
            p.sessionId,
            "Session active — checking input sources…",
          );
          this.sweepInputSourceDead(p.sessionId);
          return;
        }
        this.setActivity(p.sessionId, `Session ${p.status}`);
        this.clearConditions(p.sessionId, [
          "cycle_running",
          "waiting_retry",
          "waiting_signal",
          "waiting_scan_tick",
        ]);
      }),
    ];

    this.timer = setInterval(() => {
      void this.runSweepSafely("session-activity sweep failed");
    }, SWEEP_INTERVAL_MS);
    void this.runSweepSafely("session-activity initial sweep failed");

    return () => this.stop();
  }

  stop(): void {
    this.unsubs.forEach((unsub) => unsub());
    this.unsubs = [];
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getMonitoringHealth(): SessionActivityMonitoringHealth {
    if (this.timer == null) {
      return this.unhealthyMonitoring(
        "Session activity monitoring unavailable — detector layer is stopped.",
      );
    }
    if (this.lastSweepAt == null) {
      return this.unhealthyMonitoring(
        "Session activity monitoring unavailable — waiting for first sweep.",
        null,
      );
    }
    const ageMs = Date.now() - Date.parse(this.lastSweepAt);
    if (!Number.isFinite(ageMs) || ageMs > MONITORING_STALE_MS) {
      return this.unhealthyMonitoring(
        "Session activity monitoring unavailable — detector sweep is stale.",
      );
    }
    return { healthy: true, lastSweepAt: this.lastSweepAt, message: null };
  }

  /** Report a detected condition (idempotent — merges by kind). */
  reportCondition(
    sessionId: string,
    kind: SessionActivityConditionKind,
    severity: SessionActivitySeverity,
    message: string,
    opts?: { evidenceEventId?: string | null },
  ): void {
    const now = new Date().toISOString();
    const current = this.deps.activityRepo.get(sessionId);
    const existing = current?.conditions.find((c) => c.kind === kind);
    const isFirstOccurrence = !existing;

    const evidenceEventId =
      opts?.evidenceEventId ??
      existing?.evidenceEventId ??
      this.ensureEvidenceEventId(sessionId, kind, severity, message);

    const nextCondition: SessionActivityCondition = existing
      ? {
          ...existing,
          severity,
          message,
          count: existing.count + 1,
          evidenceEventId,
        }
      : {
          kind,
          severity,
          message,
          since: now,
          count: 1,
          evidenceEventId,
        };

    const conditions = [
      ...(current?.conditions.filter((c) => c.kind !== kind) ?? []),
      nextCondition,
    ];

    this.persistSnapshot(sessionId, current?.activity ?? message, conditions);

    if (isFirstOccurrence && (severity === "warn" || severity === "error")) {
      this.deps.notify?.(sessionId, nextCondition);
    }
  }

  clearCondition(sessionId: string, kind: SessionActivityConditionKind): void {
    const current = this.deps.activityRepo.get(sessionId);
    if (!current || !current.conditions.some((c) => c.kind === kind)) return;
    this.persistSnapshot(
      sessionId,
      current.activity,
      current.conditions.filter((c) => c.kind !== kind),
    );
  }

  private clearConditions(
    sessionId: string,
    kinds: SessionActivityConditionKind[],
  ): void {
    for (const kind of kinds) {
      this.clearCondition(sessionId, kind);
    }
  }

  private setActivity(sessionId: string, activity: string): void {
    const current = this.deps.activityRepo.get(sessionId);
    this.persistSnapshot(sessionId, activity, current?.conditions ?? []);
  }

  private handleStepFailed(p: {
    sessionId: string;
    cycleId: string;
    stage: string;
    retryable: boolean;
    errorCode: string;
    errorMessage: string;
    nextRetryAt: string | null;
  }): void {
    const evidenceEventId = this.findEvidenceEventId(
      p.sessionId,
      p.errorMessage,
    );

    if (p.nextRetryAt && Date.parse(p.nextRetryAt) > Date.now()) {
      const when = formatEt(new Date(p.nextRetryAt));
      this.reportCondition(
        p.sessionId,
        "waiting_retry",
        "info",
        `Re-evaluating after ${p.stage} failure — next attempt ${when}.`,
        { evidenceEventId },
      );
    }

    const mapped = STEP_FAILURE_CONDITIONS[p.errorCode];
    if (mapped) {
      this.reportCondition(
        p.sessionId,
        mapped.kind,
        mapped.severity,
        mapped.message(p.errorMessage),
        { evidenceEventId },
      );
      return;
    }

    this.recordFailureSignature(p.sessionId, p.errorCode || p.errorMessage);

    if (!MAPPED_FAILURE_CODES.has(p.errorCode)) {
      this.reportCondition(
        p.sessionId,
        "degraded",
        "warn",
        `Unmapped failure in ${p.stage}: ${p.errorMessage}`,
        { evidenceEventId },
      );
    }
  }

  private recordFailureSignature(sessionId: string, raw: string): void {
    const signature = raw.slice(0, 120) || "unknown";
    const nowMs = Date.now();
    const ring = (this.failureRing.get(sessionId) ?? []).filter(
      (entry) => nowMs - entry.atMs < CRASH_LOOP_WINDOW_MS,
    );
    ring.push({ signature, atMs: nowMs });
    this.failureRing.set(sessionId, ring);

    const same = ring.filter((entry) => entry.signature === signature);
    if (same.length >= CRASH_LOOP_THRESHOLD) {
      this.reportCondition(
        sessionId,
        "runtime_crash_loop",
        "error",
        `${same.length}× same runtime error in 10m: ${signature}`,
        { evidenceEventId: this.findEvidenceEventId(sessionId, signature) },
      );
    }
  }

  /** Exposed for tests; production callers rely on the internal 60s timer. */
  async runSweepNow(): Promise<void> {
    return this.sweep();
  }

  private unhealthyMonitoring(
    message: string,
    lastSweepAt: string | null = this.lastSweepAt,
  ): SessionActivityMonitoringHealth {
    return { healthy: false, lastSweepAt, message };
  }

  private async runSweepSafely(logMessage: string): Promise<void> {
    await this.sweep().catch((err) => logger.error({ err }, logMessage));
  }

  private persistSnapshot(
    sessionId: string,
    activity: string,
    conditions: SessionActivityCondition[],
  ): SessionActivitySnapshot {
    const snapshot = this.attachStats(
      this.deps.activityRepo.set({ sessionId, activity, conditions }),
    );
    this.deps.bus.emit("session_activity_changed", snapshot);
    return snapshot;
  }

  private hasCondition(
    sessionId: string,
    kinds: SessionActivityConditionKind | SessionActivityConditionKind[],
  ): boolean {
    const wanted = Array.isArray(kinds) ? kinds : [kinds];
    const conditions = this.deps.activityRepo.get(sessionId)?.conditions ?? [];
    return conditions.some((condition) => wanted.includes(condition.kind));
  }

  private listScheduledScanSubs(sessionId: string) {
    return this.deps.subscriptionRepo
      .listEnabledBySession(sessionId)
      .filter((sub) => sub.mode === "scheduled_scan");
  }

  private listEventSourceSubs(sessionId: string) {
    return this.deps.subscriptionRepo
      .listEnabledBySession(sessionId)
      .filter((sub) => sub.mode === "event_source");
  }

  private hasRunningBackingSource(sourceDefinitionId: string): boolean {
    const definition = this.deps.sourceDefinitionRepo.get(sourceDefinitionId);
    if (!definition) return false;
    return this.deps.signalSourcesRepo
      .list()
      .filter((source) => source.type === definition.kind)
      .some(
        (source) =>
          this.deps.signalRegistry.status(source.id)?.status === "running",
      );
  }

  private getScheduleStatesForSubs(subIds: Set<string>) {
    return this.deps.db.db
      .select()
      .from(scheduleRuntimeStates)
      .all()
      .filter((state) =>
        parseScheduleSubscriptionIds(state.subscriptionIdsJson).some((id) =>
          subIds.has(id),
        ),
      );
  }

  private async sweep(): Promise<void> {
    this.lastSweepAt = new Date().toISOString();
    const sessions = this.deps.sessionRepo
      .list()
      .filter((s) => s.status === "active");
    for (const session of sessions) {
      this.sweepInputSourceDead(session.id);
      this.sweepSelectorRejectingAll(session.id);
      this.sweepNoSignalStale(session);
      this.sweepMarketClosed(session.id);
      this.sweepWaitingScanTick(session.id);
      this.sweepWaitingSignal(session.id);
      this.sweepAwaitingApproval(session.id);
      this.sweepDataFeedFromSchedule(session.id);
      this.sweepProviderDegraded(session.id);
      this.sweepSpendLimit(session.id);
    }
  }

  private sweepMarketClosed(sessionId: string): void {
    const scheduledSubs = this.listScheduledScanSubs(sessionId);

    if (scheduledSubs.length === 0) {
      this.clearCondition(sessionId, "market_closed");
      return;
    }

    const now = new Date();
    const closedCalendars = scheduledSubs
      .map((sub) => this.deps.calendarRegistry.get(sub.marketCalendarId))
      .filter((cal): cal is NonNullable<typeof cal> => cal !== null);

    // Calendar id present but registry miss → misconfigured (fail loud).
    const missingCalendar = scheduledSubs.some(
      (sub) =>
        sub.marketCalendarId &&
        this.deps.calendarRegistry.get(sub.marketCalendarId) == null,
    );
    if (missingCalendar) {
      this.reportCondition(
        sessionId,
        "calendar_misconfigured",
        "error",
        "Market calendar id is set but missing from the registry.",
      );
    } else {
      this.clearCondition(sessionId, "calendar_misconfigured");
    }

    const allClosed =
      closedCalendars.length > 0 &&
      closedCalendars.every((cal) => !cal.isOpen(now));

    if (!allClosed) {
      this.clearCondition(sessionId, "market_closed");
      return;
    }

    const nextOpenAt = findNextOpen(closedCalendars, now);
    const when = nextOpenAt ? formatEt(nextOpenAt) : "next session";
    this.reportCondition(
      sessionId,
      "market_closed",
      "info",
      `Market closed — resumes ${when}.`,
    );
    this.clearCondition(sessionId, "waiting_scan_tick");
  }

  private sweepWaitingScanTick(sessionId: string): void {
    if (
      this.hasCondition(sessionId, ["market_closed", "cycle_running"])
    ) {
      this.clearCondition(sessionId, "waiting_scan_tick");
      return;
    }

    const scheduledSubs = this.listScheduledScanSubs(sessionId);
    if (scheduledSubs.length === 0) {
      this.clearCondition(sessionId, "waiting_scan_tick");
      return;
    }

    const subIds = new Set(scheduledSubs.map((sub) => sub.id));
    let nextRunAt: string | null = null;
    for (const state of this.getScheduleStatesForSubs(subIds)) {
      if (state.nextRunAt && (!nextRunAt || state.nextRunAt < nextRunAt)) {
        nextRunAt = state.nextRunAt;
      }
    }

    if (!nextRunAt) {
      this.clearCondition(sessionId, "waiting_scan_tick");
      return;
    }

    const when = formatEt(new Date(nextRunAt));
    this.reportCondition(
      sessionId,
      "waiting_scan_tick",
      "info",
      `Waiting for next scan tick at ${when}.`,
    );
  }

  private sweepWaitingSignal(sessionId: string): void {
    if (
      this.hasCondition(sessionId, [
        "cycle_running",
        "input_source_dead",
        "no_signal_stale",
      ])
    ) {
      this.clearCondition(sessionId, "waiting_signal");
      return;
    }

    const eventSubs = this.listEventSourceSubs(sessionId);
    if (eventSubs.length === 0) {
      this.clearCondition(sessionId, "waiting_signal");
      return;
    }

    // Only claim "waiting for signal" when backing sources look healthy.
    const anyLive = eventSubs.some((sub) =>
      this.hasRunningBackingSource(sub.sourceDefinitionId),
    );
    if (!anyLive) {
      this.clearCondition(sessionId, "waiting_signal");
      return;
    }

    const pending = this.deps.db.db
      .select()
      .from(sessionSignalDeliveries)
      .where(
        and(
          eq(sessionSignalDeliveries.sessionId, sessionId),
          eq(sessionSignalDeliveries.statusBucket, "pending"),
        ),
      )
      .limit(1)
      .all();
    if (pending.length > 0) {
      this.clearCondition(sessionId, "waiting_signal");
      return;
    }

    this.reportCondition(
      sessionId,
      "waiting_signal",
      "info",
      "Subscription live — waiting for next signal.",
    );
  }

  private sweepNoSignalStale(session: {
    id: string;
    createdAt: string;
  }): void {
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
      this.clearCondition(session.id, "waiting_signal");
    } else {
      this.clearCondition(session.id, "no_signal_stale");
    }
  }

  private sweepInputSourceDead(sessionId: string): void {
    const subscriptions = this.listEventSourceSubs(sessionId);
    const dead = subscriptions.some((sub) => {
      if (!this.deps.sourceDefinitionRepo.get(sub.sourceDefinitionId)) {
        return false;
      }
      return !this.hasRunningBackingSource(sub.sourceDefinitionId);
    });

    if (dead) {
      this.reportCondition(
        sessionId,
        "input_source_dead",
        "error",
        "Subscribed to an event source with no running backing poller — this session can never receive a signal.",
        { evidenceEventId: this.findEvidenceEventId(sessionId) },
      );
      this.clearCondition(sessionId, "waiting_signal");
    } else {
      this.clearCondition(sessionId, "input_source_dead");
    }
  }

  private sweepSelectorRejectingAll(sessionId: string): void {
    const { reasons, evidenceEventId } =
      this.collectSelectorRejectReasons(sessionId);

    if (reasons.length < SELECTOR_REJECT_THRESHOLD) {
      this.clearCondition(sessionId, "selector_rejecting_all");
      return;
    }

    const dominant =
      dominantString(reasons.slice(0, SELECTOR_REJECT_THRESHOLD)) ??
      "unknown rejection reason";
    this.reportCondition(
      sessionId,
      "selector_rejecting_all",
      "warn",
      `Last ${SELECTOR_REJECT_THRESHOLD} selector cycles produced 0 accepted candidates — dominant reason: ${dominant}`,
      { evidenceEventId },
    );
  }

  /**
   * Gather reject reasons from events (preferred), then step outcomes, then
   * consecutive rejected deliveries — stop once we have enough samples.
   */
  private collectSelectorRejectReasons(sessionId: string): {
    reasons: string[];
    evidenceEventId: string | null;
  } {
    const reasons: string[] = [];
    let evidenceEventId: string | null = null;

    // Primary: orchestrator events on zero-accept / no-trade cycles.
    const rejectEvents = this.deps.db.db
      .select()
      .from(events)
      .where(eq(events.sessionId, sessionId))
      .orderBy(desc(events.createdAt))
      .limit(40)
      .all()
      .filter((row) => SELECTOR_REJECT_MESSAGE_RE.test(row.message));

    const seenCycles = new Set<string>();
    for (const row of rejectEvents) {
      const cycleKey = row.cycleId ?? row.id;
      if (seenCycles.has(cycleKey)) continue;
      seenCycles.add(cycleKey);
      reasons.push(
        extractSelectorRejectReason(row.message) ?? "no candidates accepted",
      );
      evidenceEventId ??= row.id;
      if (reasons.length >= SELECTOR_REJECT_THRESHOLD) {
        return { reasons, evidenceEventId };
      }
    }

    // Fallback: persisted step outcomes (tests / older writers).
    const noTradeRows = this.deps.db.db
      .select()
      .from(sessionExecutionSteps)
      .where(
        and(
          eq(sessionExecutionSteps.sessionId, sessionId),
          eq(sessionExecutionSteps.stage, "selector"),
        ),
      )
      .orderBy(desc(sessionExecutionSteps.createdAt))
      .limit(SELECTOR_REJECT_THRESHOLD)
      .all()
      .filter((row) => row.outcome === "no_trade");

    if (noTradeRows.length >= SELECTOR_REJECT_THRESHOLD) {
      for (const row of noTradeRows) {
        reasons.push(
          row.lastErrorMessage?.trim() ||
            row.lastErrorCode?.trim() ||
            "no_trade",
        );
      }
    }

    if (reasons.length >= SELECTOR_REJECT_THRESHOLD) {
      return { reasons, evidenceEventId };
    }

    // Secondary: consecutive rejected signal deliveries.
    const deliveries = this.deps.db.db
      .select()
      .from(sessionSignalDeliveries)
      .where(eq(sessionSignalDeliveries.sessionId, sessionId))
      .orderBy(desc(sessionSignalDeliveries.finishedAt))
      .limit(SELECTOR_REJECT_THRESHOLD)
      .all();

    if (
      deliveries.length >= SELECTOR_REJECT_THRESHOLD &&
      deliveries.every((row) => row.status === "rejected")
    ) {
      for (const row of deliveries) {
        reasons.push(row.dropReason?.trim() || "signal rejected");
      }
    }

    return { reasons, evidenceEventId };
  }

  private sweepAwaitingApproval(sessionId: string): void {
    const pending =
      this.deps.tradeApprovalsRepo
        ?.listPending()
        .filter((row) => row.sessionId === sessionId) ?? [];
    if (pending.length === 0) {
      this.clearCondition(sessionId, "awaiting_approval");
      return;
    }
    const symbols = [...new Set(pending.map((p) => p.instrumentSymbol))].join(
      ", ",
    );
    this.reportCondition(
      sessionId,
      "awaiting_approval",
      "attention",
      `Awaiting approval for ${pending.length} trade(s): ${symbols}.`,
    );
  }

  private sweepDataFeedFromSchedule(sessionId: string): void {
    const scheduledSubs = this.listScheduledScanSubs(sessionId);
    if (scheduledSubs.length === 0) return;

    const subIds = new Set(scheduledSubs.map((sub) => sub.id));
    const relevant = this.getScheduleStatesForSubs(subIds);
    if (relevant.length === 0) return;

    const failing = relevant.filter((s) => s.consecutiveFailures > 0);
    if (failing.length === 0) {
      this.clearCondition(sessionId, "data_feed_failing");
      return;
    }

    const worst = failing.reduce((a, b) =>
      a.consecutiveFailures >= b.consecutiveFailures ? a : b,
    );
    this.reportCondition(
      sessionId,
      "data_feed_failing",
      "error",
      `Data feed failing (${worst.consecutiveFailures} consecutive): ${worst.lastError ?? "unknown error"}`,
      {
        evidenceEventId: this.findEvidenceEventId(
          sessionId,
          worst.lastError ?? undefined,
        ),
      },
    );
  }

  private sweepProviderDegraded(sessionId: string): void {
    const since = new Date(Date.now() - PROVIDER_WINDOW_MS).toISOString();
    const rows = this.deps.db.db
      .select()
      .from(apiCallLog)
      .where(
        and(
          eq(apiCallLog.sessionId, sessionId),
          sql`${apiCallLog.createdAt} >= ${since}`,
        ),
      )
      .all();

    if (rows.length < PROVIDER_MIN_CALLS) {
      this.clearCondition(sessionId, "provider_degraded");
      return;
    }

    const errors = rows.filter((row) => isProviderCallError(row.status));
    const rate = errors.length / rows.length;
    if (rate >= PROVIDER_ERROR_RATE) {
      this.reportCondition(
        sessionId,
        "provider_degraded",
        "warn",
        `Provider error rate ${(rate * 100).toFixed(0)}% over last 15m (${errors.length}/${rows.length} calls).`,
      );
    } else {
      this.clearCondition(sessionId, "provider_degraded");
    }
  }

  private sweepSpendLimit(sessionId: string): void {
    const day = new Date().toISOString().slice(0, 10);
    const row = this.deps.db.db
      .select({
        total: sql<number>`coalesce(sum(${apiCallLog.costUsd}), 0)`,
      })
      .from(apiCallLog)
      .where(
        and(
          eq(apiCallLog.sessionId, sessionId),
          sql`substr(${apiCallLog.createdAt}, 1, 10) = ${day}`,
        ),
      )
      .get();
    const spend = Number(row?.total ?? 0);
    if (!Number.isFinite(spend)) return;

    if (spend >= this.aiSpendLimitUsd) {
      this.clearCondition(sessionId, "spend_limit_near");
      this.reportCondition(
        sessionId,
        "spend_limit_hit",
        "error",
        `AI spend $${spend.toFixed(2)} hit soft limit $${this.aiSpendLimitUsd.toFixed(0)}.`,
      );
      return;
    }

    this.clearCondition(sessionId, "spend_limit_hit");
    const near = this.aiSpendLimitUsd * SPEND_NEAR_RATIO;
    if (spend >= near) {
      this.reportCondition(
        sessionId,
        "spend_limit_near",
        "warn",
        `AI spend $${spend.toFixed(2)} near soft limit $${this.aiSpendLimitUsd.toFixed(0)}.`,
      );
    } else {
      this.clearCondition(sessionId, "spend_limit_near");
    }
  }

  private findEvidenceEventId(
    sessionId: string,
    needle?: string,
  ): string | null {
    const rows = this.deps.db.db
      .select()
      .from(events)
      .where(eq(events.sessionId, sessionId))
      .orderBy(desc(events.createdAt))
      .limit(30)
      .all();
    if (needle) {
      const fragment = needle.slice(0, 48);
      const match = rows.find((row) => row.message.includes(fragment));
      if (match) return match.id;
    }
    return (
      rows.find((row) => row.level === "ERROR" || row.level === "WARN")?.id ??
      rows[0]?.id ??
      null
    );
  }

  /**
   * AC #4: every condition row must link to a concrete events-table record.
   * Prefer an existing matching event; otherwise write a diagnostic row.
   */
  private ensureEvidenceEventId(
    sessionId: string,
    kind: SessionActivityConditionKind,
    severity: SessionActivitySeverity,
    message: string,
  ): string {
    const marker = `[session_activity:${kind}]`;
    const existing = this.findEvidenceEventId(sessionId, marker);
    if (existing) return existing;

    const related = this.findEvidenceEventId(sessionId, message.slice(0, 48));
    if (related) return related;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.deps.db.db
      .insert(events)
      .values({
        id,
        sessionId,
        tradeId: null,
        cycleId: null,
        level: severityToLogLevel(severity),
        agentType: "session",
        message: `${marker} ${message}`,
        createdAt: now,
      })
      .run();
    return id;
  }

  private computeStats(sessionId: string): SessionActivityStats {
    const cyclesRun = this.deps.db.db
      .select({
        n: sql<number>`count(distinct ${sessionExecutionSteps.cycleId})`,
      })
      .from(sessionExecutionSteps)
      .where(eq(sessionExecutionSteps.sessionId, sessionId))
      .get();
    const signalsReceived = this.deps.db.db
      .select({ n: sql<number>`count(*)` })
      .from(sessionSignalDeliveries)
      .where(eq(sessionSignalDeliveries.sessionId, sessionId))
      .get();
    const tradesOpened = this.deps.db.db
      .select({ n: sql<number>`count(*)` })
      .from(trades)
      .where(eq(trades.sessionId, sessionId))
      .get();
    const errorCount = this.deps.db.db
      .select({ n: sql<number>`count(*)` })
      .from(events)
      .where(
        and(eq(events.sessionId, sessionId), eq(events.level, "ERROR")),
      )
      .get();
    return {
      cyclesRun: Number(cyclesRun?.n ?? 0),
      signalsReceived: Number(signalsReceived?.n ?? 0),
      tradesOpened: Number(tradesOpened?.n ?? 0),
      errors: Number(errorCount?.n ?? 0),
    };
  }

  private computeLastCycleOutcome(sessionId: string): string | null {
    const rejectEvent = this.deps.db.db
      .select()
      .from(events)
      .where(eq(events.sessionId, sessionId))
      .orderBy(desc(events.createdAt))
      .limit(20)
      .all()
      .find((row) => SELECTOR_REJECT_MESSAGE_RE.test(row.message));

    if (rejectEvent) {
      const reason = extractSelectorRejectReason(rejectEvent.message);
      if (reason) return `last cycle: 0 candidates accepted — ${reason}`;
      const bare = rejectEvent.message.replace(/^\[stage:selector\]\s*/i, "");
      return `last cycle: ${bare}`;
    }

    const step = this.deps.db.db
      .select()
      .from(sessionExecutionSteps)
      .where(eq(sessionExecutionSteps.sessionId, sessionId))
      .orderBy(desc(sessionExecutionSteps.updatedAt))
      .limit(1)
      .get();
    if (!step) return null;

    const stepDetail =
      step.lastErrorMessage?.trim() || step.lastErrorCode?.trim() || null;

    if (step.outcome === "no_trade") {
      return stepDetail
        ? `last cycle: no trade — ${stepDetail}`
        : "last cycle: no trade";
    }
    switch (step.status) {
      case "failed":
        return `last cycle: ${step.stage} failed — ${stepDetail ?? "error"}`;
      case "succeeded":
        return `last cycle: ${step.stage} completed`;
      case "running":
      case "retrying":
        return `last cycle: ${step.stage} ${step.status}`;
      default:
        return null;
    }
  }

  private attachStats(snapshot: SessionActivitySnapshot): SessionActivitySnapshot {
    return {
      ...snapshot,
      stats: this.computeStats(snapshot.sessionId),
      lastCycleOutcome: this.computeLastCycleOutcome(snapshot.sessionId),
    };
  }

  getSnapshot(sessionId: string): SessionActivitySnapshot | null {
    const snapshot = this.deps.activityRepo.get(sessionId);
    return snapshot ? this.attachStats(snapshot) : null;
  }

  listSnapshots(): SessionActivitySnapshot[] {
    return this.deps.activityRepo.list().map((row) => this.attachStats(row));
  }

  /** Most-recent-first history of activity/condition transitions for a session. */
  listTransitions(sessionId: string, limit?: number): SessionActivitySnapshot[] {
    return this.deps.activityRepo.listTransitions(sessionId, limit);
  }

  getAnalytics(
    sessionId: string,
    limit = 200,
  ): SessionActivityAnalytics {
    return computeSessionActivityAnalytics(
      this.deps.activityRepo.listTransitions(sessionId, limit),
    );
  }
}
