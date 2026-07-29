import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../../../db/test-helpers";
import type { DbClient } from "../../../db/client";
import {
  apiCallLog,
  events,
  scheduleRuntimeStates,
  sessionExecutionSteps,
  sessions,
} from "../../../db/schema";
import { SessionActivityRepo } from "../../../db/repositories/sessions/session-activity-repo";
import { SessionInputSubscriptionRepo } from "../../session-inputs/session-input-subscription-repo";
import { SourceDefinitionRepo } from "../../signals/source-definition-repo";
import { SignalSourcesRepo } from "../../signals/repos/signal-sources-repo";
import { EventBus } from "../../infra/event-bus";
import {
  SessionActivityTracker,
  type SessionActivityTrackerDeps,
} from "../session-activity-tracker";
import type { SessionActivityCondition } from "@electron/shared/domain/session-activity";

const SESSION_ID = "session-1";
const SOURCE_DEFINITION_ID = "source-def/edgar-8k-catalyst";

function insertSession(
  db: DbClient,
  overrides: Partial<{
    id: string;
    name: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    experienceId: string;
  }> = {},
): string {
  const now = new Date().toISOString();
  const id = overrides.id ?? SESSION_ID;
  db.db
    .insert(sessions)
    .values({
      id,
      name: overrides.name ?? "Test Session",
      objective: "test",
      status: overrides.status ?? "active",
      isFocused: false,
      selectionMode: "manual_shortlist",
      instrumentClasses: "stock",
      instrumentScope: "",
      executionMode: "paper_only",
      experienceId: overrides.experienceId ?? "edgar-catalyst",
      sessionInputRevision: 0,
      createdAt: overrides.createdAt ?? now,
      updatedAt: overrides.updatedAt ?? now,
    })
    .run();
  return id;
}

function createTracker(
  db: DbClient,
  overrides: Partial<SessionActivityTrackerDeps> = {},
): SessionActivityTracker {
  return new SessionActivityTracker({
    activityRepo: new SessionActivityRepo(db),
    subscriptionRepo: new SessionInputSubscriptionRepo(db),
    sourceDefinitionRepo: new SourceDefinitionRepo(db),
    signalSourcesRepo: new SignalSourcesRepo(db),
    signalRegistry: { status: () => null },
    signalSourceRuntimeRepo: { get: () => null },
    calendarRegistry: { get: () => null },
    sessionRepo: {
      list: () => [
        {
          id: SESSION_ID,
          status: "active",
          createdAt: new Date().toISOString(),
        },
      ],
    },
    db,
    bus: new EventBus(),
    ...overrides,
  });
}

function createStartedTracker(
  db: DbClient,
  overrides: Partial<SessionActivityTrackerDeps> = {},
): {
  tracker: SessionActivityTracker;
  bus: EventBus;
  activityRepo: SessionActivityRepo;
} {
  const bus = overrides.bus ?? new EventBus();
  const activityRepo = overrides.activityRepo ?? new SessionActivityRepo(db);
  const tracker = createTracker(db, { bus, activityRepo, ...overrides });
  tracker.start();
  return { tracker, bus, activityRepo };
}

describe("SessionActivityTracker — input_source_dead journey", () => {
  let db: DbClient;
  let subscriptionRepo: SessionInputSubscriptionRepo;
  let sourceDefinitionRepo: SourceDefinitionRepo;
  let signalSourcesRepo: SignalSourcesRepo;
  let activityRepo: SessionActivityRepo;
  let tracker: SessionActivityTracker;
  let notified: Array<{
    sessionId: string;
    condition: SessionActivityCondition;
  }>;
  let registryStatus: "running" | null;

  beforeEach(() => {
    db = createTestDb();
    insertSession(db);
    subscriptionRepo = new SessionInputSubscriptionRepo(db);
    sourceDefinitionRepo = new SourceDefinitionRepo(db);
    signalSourcesRepo = new SignalSourcesRepo(db);
    activityRepo = new SessionActivityRepo(db);
    notified = [];
    registryStatus = null;

    sourceDefinitionRepo.createIfAbsent({
      id: SOURCE_DEFINITION_ID,
      kind: "edgar_8k",
      name: "EDGAR 8-K Catalyst",
      outputContractId: "signal/filing",
      config: {},
    });
    subscriptionRepo.create(SESSION_ID, {
      mode: "event_source",
      templateId: "edgar-catalyst",
      templateVersion: 1,
      sourceDefinitionId: SOURCE_DEFINITION_ID,
      sourceRevision: 1,
      filters: {},
      analysisTimeframe: "1d",
    });

    tracker = createTracker(db, {
      signalRegistry: {
        status: () =>
          registryStatus ? { status: "running", lastError: null } : null,
      },
      notify: (sessionId, condition) => notified.push({ sessionId, condition }),
    });
  });

  it("flags input_source_dead and notifies when no live poller backs the subscription", async () => {
    await tracker.runSweepNow();

    const snapshot = activityRepo.get(SESSION_ID);
    expect(snapshot?.conditions).toHaveLength(1);
    expect(snapshot?.conditions[0]).toMatchObject({
      kind: "input_source_dead",
      severity: "error",
    });
    expect(snapshot?.conditions[0].evidenceEventId).toEqual(expect.any(String));
    expect(notified).toHaveLength(1);
    expect(notified[0].condition.kind).toBe("input_source_dead");
  });

  it("does not re-notify or inflate counts on repeated unchanged sweeps", async () => {
    await tracker.runSweepNow();
    await tracker.runSweepNow();
    await tracker.runSweepNow();

    expect(notified).toHaveLength(1);
    expect(activityRepo.get(SESSION_ID)?.conditions[0].count).toBe(1);
    expect(activityRepo.listTransitions(SESSION_ID)).toHaveLength(1);
  });

  it("clears the condition once a matching live signal source starts running", async () => {
    await tracker.runSweepNow();
    expect(activityRepo.get(SESSION_ID)?.conditions).toHaveLength(1);

    signalSourcesRepo.create({
      id: "source/edgar_8k",
      type: "edgar_8k",
      name: "EDGAR 8-K Catalyst",
      description: null,
      enabled: true,
      configJson: "{}",
    });
    registryStatus = "running";

    await tracker.runSweepNow();

    const conditions = activityRepo.get(SESSION_ID)?.conditions ?? [];
    expect(conditions.some((c) => c.kind === "input_source_dead")).toBe(false);
    expect(conditions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "waiting_signal", severity: "info" }),
      ]),
    );
  });

  it("flags input_source_dead when durable poll health is error despite registry running", async () => {
    signalSourcesRepo.create({
      id: "source/edgar_8k",
      type: "edgar_8k",
      name: "EDGAR 8-K Catalyst",
      description: null,
      enabled: true,
      configJson: "{}",
    });
    registryStatus = "running";

    tracker = createTracker(db, {
      signalRegistry: {
        status: () =>
          registryStatus ? { status: "running", lastError: null } : null,
      },
      signalSourceRuntimeRepo: {
        get: () => ({
          sourceId: "source/edgar_8k",
          status: "error",
          lastPollAt: "2026-07-20T17:00:00.000Z",
          lastSuccessAt: null,
          consecutiveFailures: 2,
          lastError: "EDGAR feed status 503",
          lastOutcome: "http_error",
          httpStatus: 503,
          detected: 0,
          passed: 0,
          dropped: 0,
          errors: ["EDGAR feed status 503"],
          updatedAt: "2026-07-20T17:00:00.000Z",
        }),
      },
      notify: (sessionId, condition) => notified.push({ sessionId, condition }),
      subscriptionRepo,
      sourceDefinitionRepo,
      signalSourcesRepo,
      activityRepo,
    });

    await tracker.runSweepNow();

    expect(activityRepo.get(SESSION_ID)?.conditions[0]).toMatchObject({
      kind: "input_source_dead",
      severity: "error",
    });
  });
});

describe("SessionActivityTracker — market_closed", () => {
  const CLOSED_SESSION_ID = "session-closed";

  function seedScheduledScanSession(db: DbClient): void {
    insertSession(db, {
      id: CLOSED_SESSION_ID,
      name: "Scheduled scan",
      experienceId: "rules-mean-reversion",
    });
    new SessionInputSubscriptionRepo(db).create(CLOSED_SESSION_ID, {
      mode: "scheduled_scan",
      templateId: "rules-mean-reversion",
      templateVersion: 1,
      instrumentSetId: "liquid-us-etfs",
      instrumentSetRevision: 1,
      cadence: { kind: "interval", every: 15, unit: "minute", jitterPct: 0.05 },
      analysisTimeframe: "1h",
      marketCalendarId: "nyse-regular",
      strategyParameters: {},
    });
  }

  function buildTracker(
    db: DbClient,
    isOpen: () => boolean,
  ): SessionActivityTracker {
    return createTracker(db, {
      calendarRegistry: {
        get: () => ({ id: "nyse-regular", isOpen }),
      },
      sessionRepo: {
        list: () => [
          {
            id: CLOSED_SESSION_ID,
            status: "active",
            createdAt: new Date().toISOString(),
          },
        ],
      },
    });
  }

  it("flags market_closed (info) for a scheduled-scan session while its calendar is closed", async () => {
    const db = createTestDb();
    seedScheduledScanSession(db);
    const tracker = buildTracker(db, () => false);

    await tracker.runSweepNow();

    const snapshot = new SessionActivityRepo(db).get(CLOSED_SESSION_ID);
    expect(snapshot?.conditions).toHaveLength(1);
    expect(snapshot?.conditions[0]).toMatchObject({
      kind: "market_closed",
      severity: "info",
    });
    expect(snapshot?.conditions[0].message).toMatch(/resumes/i);
  });

  it("clears market_closed once the calendar reopens", async () => {
    const db = createTestDb();
    seedScheduledScanSession(db);

    let open = false;
    const tracker = buildTracker(db, () => open);

    await tracker.runSweepNow();
    expect(
      new SessionActivityRepo(db).get(CLOSED_SESSION_ID)?.conditions,
    ).toHaveLength(1);

    open = true;
    await tracker.runSweepNow();
    expect(
      new SessionActivityRepo(db).get(CLOSED_SESSION_ID)?.conditions,
    ).toHaveLength(0);
  });
});

describe("SessionActivityTracker — no_signal_stale watchdog", () => {
  const OTHER_SESSION_ID = "session-stale";

  function buildTracker(
    db: DbClient,
    createdAt: string,
    notified: Array<{ sessionId: string; condition: SessionActivityCondition }>,
  ): SessionActivityTracker {
    return createTracker(db, {
      sessionRepo: {
        list: () => [{ id: OTHER_SESSION_ID, status: "active", createdAt }],
      },
      notify: (sessionId, condition) => notified.push({ sessionId, condition }),
    });
  }

  it("stays quiet within the grace period even with zero activity", async () => {
    const db = createTestDb();
    insertSession(db, { id: OTHER_SESSION_ID, name: "Stale-ish" });
    const notified: Array<{
      sessionId: string;
      condition: SessionActivityCondition;
    }> = [];
    const tracker = buildTracker(db, new Date().toISOString(), notified);

    await tracker.runSweepNow();

    expect(
      new SessionActivityRepo(db).get(OTHER_SESSION_ID)?.conditions ?? [],
    ).toHaveLength(0);
  });

  it("flags no_signal_stale once the grace period passes with zero execution steps and zero deliveries", async () => {
    const db = createTestDb();
    const oldCreatedAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    insertSession(db, {
      id: OTHER_SESSION_ID,
      name: "Truly stale",
      createdAt: oldCreatedAt,
      updatedAt: oldCreatedAt,
    });
    const notified: Array<{
      sessionId: string;
      condition: SessionActivityCondition;
    }> = [];
    const tracker = buildTracker(db, oldCreatedAt, notified);

    await tracker.runSweepNow();

    const snapshot = new SessionActivityRepo(db).get(OTHER_SESSION_ID);
    expect(snapshot?.conditions).toHaveLength(1);
    expect(snapshot?.conditions[0]).toMatchObject({
      kind: "no_signal_stale",
      severity: "warn",
    });
    expect(notified).toHaveLength(1);
  });
});

describe("SessionActivityTracker — event-driven conditions", () => {
  it("flags cycle_running on step:started and clears on step:succeeded", () => {
    const db = createTestDb();
    insertSession(db);
    const { tracker, bus, activityRepo } = createStartedTracker(db);

    bus.emit("step:started", {
      sessionId: SESSION_ID,
      cycleId: "cycle-abc",
      stage: "selector",
      attempt: 1,
    });
    expect(activityRepo.get(SESSION_ID)?.conditions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "cycle_running", severity: "info" }),
      ]),
    );

    bus.emit("step:succeeded", {
      sessionId: SESSION_ID,
      cycleId: "cycle-abc",
      stage: "selector",
    });
    expect(
      activityRepo
        .get(SESSION_ID)
        ?.conditions.some((c) => c.kind === "cycle_running"),
    ).toBe(false);

    tracker.stop();
  });

  it("flags waiting_retry on step:retrying", () => {
    const db = createTestDb();
    insertSession(db);
    const { tracker, bus, activityRepo } = createStartedTracker(db);

    const nextRetryAt = new Date(Date.now() + 5 * 60_000).toISOString();
    bus.emit("step:retrying", {
      sessionId: SESSION_ID,
      cycleId: "cycle-1",
      stage: "selector",
      attempt: 2,
      nextRetryAt,
    });

    expect(activityRepo.get(SESSION_ID)?.conditions[0]).toMatchObject({
      kind: "waiting_retry",
      severity: "info",
    });
    tracker.stop();
  });

  it("flags symbol_locked and allocation_blocked from step:failed codes", () => {
    const db = createTestDb();
    insertSession(db);
    const { tracker, bus, activityRepo } = createStartedTracker(db);

    bus.emit("step:failed", {
      sessionId: SESSION_ID,
      cycleId: "c1",
      stage: "broker_order",
      retryable: false,
      errorCode: "INSTRUMENT_CONFLICT",
      errorMessage: "AAPL locked by session-2",
      nextRetryAt: null,
    });
    expect(activityRepo.get(SESSION_ID)?.conditions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "symbol_locked" }),
      ]),
    );

    bus.emit("step:failed", {
      sessionId: SESSION_ID,
      cycleId: "c2",
      stage: "broker_order",
      retryable: false,
      errorCode: "BROKER_ALLOCATION_EXHAUSTED",
      errorMessage: "no capital left",
      nextRetryAt: null,
    });
    expect(activityRepo.get(SESSION_ID)?.conditions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "allocation_blocked",
          severity: "warn",
        }),
      ]),
    );
    tracker.stop();
  });

  it("flags runtime_crash_loop after repeated identical failures", () => {
    const db = createTestDb();
    insertSession(db);
    const notified: SessionActivityCondition[] = [];
    const { tracker, bus, activityRepo } = createStartedTracker(db, {
      notify: (_id, condition) => notified.push(condition),
    });

    for (let i = 0; i < 5; i++) {
      bus.emit("step:failed", {
        sessionId: SESSION_ID,
        cycleId: `c-${i}`,
        stage: "selector",
        retryable: true,
        errorCode: "NETWORK_ERROR",
        errorMessage: "getBars TypeError: fetch failed",
        nextRetryAt: null,
      });
    }

    expect(activityRepo.get(SESSION_ID)?.conditions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "runtime_crash_loop",
          severity: "error",
        }),
      ]),
    );
    expect(notified.some((c) => c.kind === "runtime_crash_loop")).toBe(true);
    tracker.stop();
  });
});

describe("SessionActivityTracker — awaiting_approval + spend + monitoring", () => {
  it("flags awaiting_approval from pending trade approvals", async () => {
    const db = createTestDb();
    insertSession(db);
    const activityRepo = new SessionActivityRepo(db);
    const tracker = createTracker(db, {
      activityRepo,
      tradeApprovalsRepo: {
        listPending: () => [
          { sessionId: SESSION_ID, instrumentSymbol: "NVDA" },
        ],
      },
    });

    await tracker.runSweepNow();
    expect(activityRepo.get(SESSION_ID)?.conditions[0]).toMatchObject({
      kind: "awaiting_approval",
      severity: "attention",
    });
  });

  it("flags spend_limit_near and spend_limit_hit from api_call_log", async () => {
    const db = createTestDb();
    insertSession(db);
    const activityRepo = new SessionActivityRepo(db);
    const day = new Date().toISOString();
    db.db
      .insert(apiCallLog)
      .values({
        id: "call-1",
        sessionId: SESSION_ID,
        tradeId: null,
        cycleId: null,
        provider: "openrouter",
        endpoint: "/chat",
        callType: "llm",
        creditsUsed: null,
        costUsd: 21,
        latencyMs: 100,
        status: "ok",
        fromCache: false,
        createdAt: day,
      })
      .run();

    const tracker = createTracker(db, {
      activityRepo,
      aiSpendLimitUsd: 25,
    });

    await tracker.runSweepNow();
    expect(activityRepo.get(SESSION_ID)?.conditions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "spend_limit_near", severity: "warn" }),
      ]),
    );

    db.db
      .insert(apiCallLog)
      .values({
        id: "call-2",
        sessionId: SESSION_ID,
        tradeId: null,
        cycleId: null,
        provider: "openrouter",
        endpoint: "/chat",
        callType: "llm",
        creditsUsed: null,
        costUsd: 10,
        latencyMs: 100,
        status: "ok",
        fromCache: false,
        createdAt: day,
      })
      .run();

    await tracker.runSweepNow();
    expect(activityRepo.get(SESSION_ID)?.conditions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "spend_limit_hit", severity: "error" }),
      ]),
    );
    expect(
      activityRepo
        .get(SESSION_ID)
        ?.conditions.some((c) => c.kind === "spend_limit_near"),
    ).toBe(false);
  });

  it("reports monitoring unavailable after stop", async () => {
    const db = createTestDb();
    insertSession(db);
    const { tracker } = createStartedTracker(db);
    await tracker.runSweepNow();
    expect(tracker.getMonitoringHealth().healthy).toBe(true);

    tracker.stop();
    expect(tracker.getMonitoringHealth()).toMatchObject({
      healthy: false,
      message: expect.stringMatching(/unavailable/i),
    });
  });

  it("attaches session stats on getSnapshot", async () => {
    const db = createTestDb();
    insertSession(db);
    const tracker = createTracker(db);
    tracker.reportCondition(
      SESSION_ID,
      "waiting_signal",
      "info",
      "Subscription live — waiting for next signal.",
    );
    const snapshot = tracker.getSnapshot(SESSION_ID);
    expect(snapshot?.stats).toEqual({
      cyclesRun: 0,
      signalsReceived: 0,
      tradesOpened: 0,
      errors: 0,
    });
  });

  it("always attaches evidenceEventId on reportCondition", () => {
    const db = createTestDb();
    insertSession(db);
    const activityRepo = new SessionActivityRepo(db);
    const tracker = createTracker(db, { activityRepo });

    tracker.reportCondition(
      SESSION_ID,
      "market_closed",
      "info",
      "Market closed — resumes Mon 9:30 AM EDT.",
    );

    const condition = activityRepo.get(SESSION_ID)?.conditions[0];
    expect(condition?.evidenceEventId).toEqual(expect.any(String));
    const evidence = db.db
      .select()
      .from(events)
      .where(eq(events.id, condition!.evidenceEventId!))
      .get();
    expect(evidence?.message).toMatch(/\[session_activity:market_closed\]/);
  });
});

describe("SessionActivityTracker — data_feed_failing", () => {
  const FEED_SESSION = "session-feed";

  it("flags data_feed_failing from schedule_runtime_states consecutive failures", async () => {
    const db = createTestDb();
    insertSession(db, { id: FEED_SESSION, name: "Scan feed" });
    const subscriptionRepo = new SessionInputSubscriptionRepo(db);
    const sub = subscriptionRepo.create(FEED_SESSION, {
      mode: "scheduled_scan",
      templateId: "rules-mean-reversion",
      templateVersion: 1,
      instrumentSetId: "liquid-us-etfs",
      instrumentSetRevision: 1,
      cadence: { kind: "interval", every: 15, unit: "minute", jitterPct: 0.05 },
      analysisTimeframe: "1h",
      marketCalendarId: "nyse-regular",
      strategyParameters: {},
    });
    const now = new Date().toISOString();
    db.db
      .insert(scheduleRuntimeStates)
      .values({
        groupKey: "scan/group-1",
        nextRunAt: now,
        lastStartedAt: now,
        lastFinishedAt: now,
        lastSuccessAt: null,
        lastDurationMs: 10,
        consecutiveFailures: 49,
        lastError: "TypeError: fetch failed",
        subscriptionIdsJson: JSON.stringify([sub.id]),
        instrumentCount: 5,
        updatedAt: now,
      })
      .run();

    const activityRepo = new SessionActivityRepo(db);
    const notified: SessionActivityCondition[] = [];
    const tracker = createTracker(db, {
      activityRepo,
      calendarRegistry: {
        get: () => ({ id: "nyse-regular", isOpen: () => true }),
      },
      sessionRepo: {
        list: () => [
          {
            id: FEED_SESSION,
            status: "active",
            createdAt: now,
          },
        ],
      },
      notify: (_id, condition) => notified.push(condition),
    });

    await tracker.runSweepNow();

    const condition = activityRepo
      .get(FEED_SESSION)
      ?.conditions.find((c) => c.kind === "data_feed_failing");
    expect(condition).toMatchObject({
      kind: "data_feed_failing",
      severity: "error",
    });
    expect(condition?.message).toMatch(/49 consecutive/);
    expect(condition?.message).toMatch(/TypeError: fetch failed/);
    expect(condition?.evidenceEventId).toEqual(expect.any(String));
    expect(notified.some((c) => c.kind === "data_feed_failing")).toBe(true);
  });
});

describe("SessionActivityTracker — selector_rejecting_all", () => {
  it("flags after 3 reject events and includes dominant rejection reason", async () => {
    const db = createTestDb();
    insertSession(db);
    const activityRepo = new SessionActivityRepo(db);
    const notified: SessionActivityCondition[] = [];
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      db.db
        .insert(events)
        .values({
          id: `evt-reject-${i}`,
          sessionId: SESSION_ID,
          tradeId: null,
          cycleId: `cycle-${i}`,
          level: "WARN",
          agentType: "orchestrator",
          message: `[stage:selector] no instruments accepted; 4 rejected (ABC: liquidity gate; DEF: liquidity gate)`,
          createdAt: new Date(now - i * 1000).toISOString(),
        })
        .run();
    }

    const tracker = createTracker(db, {
      activityRepo,
      notify: (_id, condition) => notified.push(condition),
    });
    await tracker.runSweepNow();

    const condition = activityRepo
      .get(SESSION_ID)
      ?.conditions.find((c) => c.kind === "selector_rejecting_all");
    expect(condition).toMatchObject({
      kind: "selector_rejecting_all",
      severity: "warn",
    });
    expect(condition?.message).toMatch(/dominant reason:\s*liquidity gate/i);
    expect(condition?.evidenceEventId).toBeTruthy();
    expect(notified.some((c) => c.kind === "selector_rejecting_all")).toBe(
      true,
    );

    const snapshot = tracker.getSnapshot(SESSION_ID);
    expect(snapshot?.lastCycleOutcome).toMatch(/liquidity gate/i);
  });
});

describe("SessionActivityTracker — launch-gate input_source_dead", () => {
  it("flags input_source_dead immediately on session_status_changed → active", () => {
    const db = createTestDb();
    insertSession(db, { status: "paused" });
    const subscriptionRepo = new SessionInputSubscriptionRepo(db);
    const sourceDefinitionRepo = new SourceDefinitionRepo(db);
    sourceDefinitionRepo.createIfAbsent({
      id: SOURCE_DEFINITION_ID,
      kind: "edgar_8k",
      name: "EDGAR 8-K Catalyst",
      outputContractId: "signal/filing",
      config: {},
    });
    subscriptionRepo.create(SESSION_ID, {
      mode: "event_source",
      templateId: "edgar-catalyst",
      templateVersion: 1,
      sourceDefinitionId: SOURCE_DEFINITION_ID,
      sourceRevision: 1,
      filters: {},
      analysisTimeframe: "1d",
    });

    const notified: SessionActivityCondition[] = [];
    const { tracker, bus, activityRepo } = createStartedTracker(db, {
      subscriptionRepo,
      sourceDefinitionRepo,
      signalRegistry: { status: () => null },
      notify: (_id, condition) => notified.push(condition),
    });

    bus.emit("session_status_changed", {
      sessionId: SESSION_ID,
      status: "active",
    });

    const condition = activityRepo
      .get(SESSION_ID)
      ?.conditions.find((c) => c.kind === "input_source_dead");
    expect(condition).toMatchObject({
      kind: "input_source_dead",
      severity: "error",
    });
    expect(condition?.evidenceEventId).toEqual(expect.any(String));
    expect(notified.some((c) => c.kind === "input_source_dead")).toBe(true);

    tracker.stop();
  });
});

describe("SessionActivityTracker — lastCycleOutcome", () => {
  it("summarizes latest completed step when no reject events exist", () => {
    const db = createTestDb();
    insertSession(db);
    const now = new Date().toISOString();
    db.db
      .insert(sessionExecutionSteps)
      .values({
        id: "step-1",
        sessionId: SESSION_ID,
        cycleId: "cycle-z",
        stage: "selector",
        status: "succeeded",
        attempt: 1,
        startedAt: now,
        completedAt: now,
        nextRetryAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        outcome: null,
        retryable: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const tracker = createTracker(db);
    tracker.reportCondition(
      SESSION_ID,
      "waiting_scan_tick",
      "info",
      "Waiting for next scan tick.",
    );
    expect(tracker.getSnapshot(SESSION_ID)?.lastCycleOutcome).toBe(
      "last cycle: selector completed",
    );
  });
});
