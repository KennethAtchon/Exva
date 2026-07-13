import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import type { DbClient } from "../../../db/client";
import { SessionInputSubscriptionRepo } from "../session-input-subscription-repo";
import { sessions } from "../../../db/schema";

function insertSession(db: DbClient, id: string): void {
  const now = new Date().toISOString();
  db.db
    .insert(sessions)
    .values({
      id,
      name: "Test Session",
      objective: "test",
      status: "draft",
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

describe("SessionInputSubscriptionRepo", () => {
  let db: DbClient;
  let repo: SessionInputSubscriptionRepo;

  beforeEach(() => {
    db = createTestDb();
    repo = new SessionInputSubscriptionRepo(db);
  });

  it("creates an event-source subscription", () => {
    insertSession(db, "session-1");
    const sub = repo.create("session-1", {
      mode: "event_source",
      templateId: "edgar-catalyst",
      templateVersion: 1,
      sourceDefinitionId: "source-def/edgar-8k-catalyst",
      sourceRevision: 1,
      filters: { min_size: 1 },
      analysisTimeframe: "1d",
    });

    expect(sub.id).toBeTruthy();
    expect(sub.mode).toBe("event_source");
    expect(sub.sessionId).toBe("session-1");
    if (sub.mode === "event_source") {
      expect(sub.sourceDefinitionId).toBe("source-def/edgar-8k-catalyst");
      expect(sub.filtersJson).toBe('{"min_size":1}');
    }
  });

  it("creates a scheduled-scan subscription", () => {
    insertSession(db, "session-2");
    const sub = repo.create("session-2", {
      mode: "scheduled_scan",
      templateId: "rules-mean-reversion",
      templateVersion: 1,
      instrumentSetId: "liquid-us-etfs",
      instrumentSetRevision: 1,
      cadence: { kind: "interval", every: 15, unit: "minute", jitterPct: 0.05 },
      analysisTimeframe: "1h",
      marketCalendarId: "nyse-regular",
      strategyParameters: { zScoreEntry: -2 },
    });

    expect(sub.mode).toBe("scheduled_scan");
    if (sub.mode === "scheduled_scan") {
      expect(sub.instrumentSetId).toBe("liquid-us-etfs");
      expect(JSON.parse(sub.cadenceJson)).toMatchObject({ kind: "interval" });
      expect(sub.marketCalendarId).toBe("nyse-regular");
    }
  });

  it("replaceSessionSubscriptions is atomic and bumps revision", () => {
    insertSession(db, "session-3");

    const result = repo.replaceSessionSubscriptions(
      "session-3",
      [
        {
          mode: "event_source",
          templateId: "edgar-catalyst",
          templateVersion: 1,
          sourceDefinitionId: "source-def/edgar-8k-catalyst",
          sourceRevision: 1,
          filters: {},
          analysisTimeframe: "1d",
        },
      ],
      0,
    );

    expect(result.inputRevision).toBe(1);
    expect(result.subscriptions).toHaveLength(1);

    // Replace again with new subscription
    const result2 = repo.replaceSessionSubscriptions(
      "session-3",
      [
        {
          mode: "scheduled_scan",
          templateId: "rules-mean-reversion",
          templateVersion: 1,
          instrumentSetId: "liquid-us-etfs",
          instrumentSetRevision: 1,
          cadence: {
            kind: "interval",
            every: 1,
            unit: "hour",
            jitterPct: 0.05,
          },
          analysisTimeframe: "1h",
          marketCalendarId: "nyse-regular",
          strategyParameters: {},
        },
      ],
      1,
    );
    expect(result2.inputRevision).toBe(2);
    expect(result2.subscriptions[0].mode).toBe("scheduled_scan");
  });

  it("replaceSessionSubscriptions throws on revision conflict", () => {
    insertSession(db, "session-4");
    expect(() => repo.replaceSessionSubscriptions("session-4", [], 99)).toThrow(
      /concurrency/i,
    );
  });

  it("getConfiguration returns current subscriptions and revision", () => {
    insertSession(db, "session-5");
    const config = repo.getConfiguration("session-5");
    expect(config.sessionId).toBe("session-5");
    expect(config.inputRevision).toBe(0);
    expect(config.subscriptions).toHaveLength(0);
  });
});
