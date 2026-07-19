import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import type { DbClient } from "../../../db/client";
import { sessions } from "../../../db/schema";
import { SessionActivityRepo } from "../../../db/repositories/sessions/session-activity-repo";
import { SessionInputSubscriptionRepo } from "../../session-inputs/session-input-subscription-repo";
import { SourceDefinitionRepo } from "../../signals/source-definition-repo";
import { SignalSourcesRepo } from "../../signals/repos/signal-sources-repo";
import { EventBus } from "../../infra/event-bus";
import { SessionActivityTracker } from "../session-activity-tracker";
import type { SessionActivityCondition } from "@electron/shared/domain/session-activity";

const SESSION_ID = "session-1";
const SOURCE_DEFINITION_ID = "source-def/edgar-8k-catalyst";

function insertSession(db: DbClient): void {
  const now = new Date().toISOString();
  db.db
    .insert(sessions)
    .values({
      id: SESSION_ID,
      name: "Test Session",
      objective: "test",
      status: "active",
      isFocused: false,
      selectionMode: "manual_shortlist",
      instrumentClasses: "stock",
      instrumentScope: "",
      executionMode: "paper_only",
      experienceId: "edgar-catalyst",
      sessionInputRevision: 0,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

describe("SessionActivityTracker — input_source_dead journey", () => {
  let db: DbClient;
  let subscriptionRepo: SessionInputSubscriptionRepo;
  let sourceDefinitionRepo: SourceDefinitionRepo;
  let signalSourcesRepo: SignalSourcesRepo;
  let activityRepo: SessionActivityRepo;
  let tracker: SessionActivityTracker;
  let notified: Array<{ sessionId: string; condition: SessionActivityCondition }>;
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

    tracker = new SessionActivityTracker({
      activityRepo,
      subscriptionRepo,
      sourceDefinitionRepo,
      signalSourcesRepo,
      signalRegistry: {
        status: () => (registryStatus ? { status: "running", lastError: null } : null),
      },
      sessionRepo: {
        list: () => [{ id: SESSION_ID, status: "active" }],
      },
      db,
      bus: new EventBus(),
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
    expect(notified).toHaveLength(1);
    expect(notified[0].condition.kind).toBe("input_source_dead");
  });

  it("does not re-notify on repeated sweeps while the condition persists", async () => {
    await tracker.runSweepNow();
    await tracker.runSweepNow();
    await tracker.runSweepNow();

    expect(notified).toHaveLength(1);
    expect(activityRepo.get(SESSION_ID)?.conditions[0].count).toBe(3);
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

    expect(activityRepo.get(SESSION_ID)?.conditions).toHaveLength(0);
  });
});
