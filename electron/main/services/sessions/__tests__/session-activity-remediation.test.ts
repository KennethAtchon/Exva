import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import type { DbClient } from "../../../db/client";
import { events, sessions } from "../../../db/schema";
import { EventsRepo } from "../../../db/repositories/system/events-repo";
import { SessionInputSubscriptionRepo } from "../../session-inputs/session-input-subscription-repo";
import { SourceDefinitionRepo } from "../../signals/source-definition-repo";
import { SignalSourcesRepo } from "../../signals/repos/signal-sources-repo";
import { remediateSessionActivityCondition } from "../session-activity-remediation";
import type { SessionActivityCondition } from "@electron/shared/domain/session-activity";

const SESSION_ID = "session-remediate";
const SOURCE_DEFINITION_ID = "source-def/edgar-8k-catalyst";

describe("session-activity-remediation", () => {
  let db: DbClient;
  let subscriptionRepo: SessionInputSubscriptionRepo;
  let sourceDefinitionRepo: SourceDefinitionRepo;
  let signalSourcesRepo: SignalSourcesRepo;
  let eventsRepo: EventsRepo;

  beforeEach(() => {
    db = createTestDb();
    const now = new Date().toISOString();
    db.db
      .insert(sessions)
      .values({
        id: SESSION_ID,
        name: "Remediate",
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
    subscriptionRepo = new SessionInputSubscriptionRepo(db);
    sourceDefinitionRepo = new SourceDefinitionRepo(db);
    signalSourcesRepo = new SignalSourcesRepo(db);
    eventsRepo = new EventsRepo(db);

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
  });

  it("restarts dead input sources for input_source_dead", async () => {
    const start = vi.fn(async () => undefined);
    const create = vi.fn();
    const registry = {
      get: () => null,
      create,
      start,
      status: () => ({ status: "stopped" as const, lastError: null }),
    };

    const condition: SessionActivityCondition = {
      kind: "input_source_dead",
      severity: "error",
      message: "no poller",
      since: new Date().toISOString(),
      count: 1,
      evidenceEventId: "e1",
    };

    await remediateSessionActivityCondition(
      {
        subscriptionRepo,
        sourceDefinitionRepo,
        signalSourcesRepo,
        signalRegistry: registry as never,
        events: eventsRepo,
        pauseSession: vi.fn(),
        getSessionStatus: () => "active",
      },
      SESSION_ID,
      condition,
    );

    expect(start).toHaveBeenCalled();
    const rows = db.db.select().from(events).all();
    expect(rows.some((row) => row.message.includes("Auto-remediation"))).toBe(
      true,
    );
  });

  it("auto-pauses on data_feed_failing", async () => {
    const pauseSession = vi.fn(async () => undefined);
    const condition: SessionActivityCondition = {
      kind: "data_feed_failing",
      severity: "error",
      message: "TypeError fetch failed",
      since: new Date().toISOString(),
      count: 1,
      evidenceEventId: "e2",
    };

    await remediateSessionActivityCondition(
      {
        subscriptionRepo,
        sourceDefinitionRepo,
        signalSourcesRepo,
        signalRegistry: {
          get: () => null,
          create: vi.fn(),
          start: vi.fn(),
          status: () => null,
        } as never,
        events: eventsRepo,
        pauseSession,
        getSessionStatus: () => "active",
      },
      SESSION_ID,
      condition,
    );

    expect(pauseSession).toHaveBeenCalledWith(
      SESSION_ID,
      expect.stringContaining("data_feed_failing"),
    );
  });
});
