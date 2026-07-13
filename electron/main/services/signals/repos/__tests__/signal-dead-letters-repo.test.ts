import { describe, expect, it } from "vitest";
import { createTestDb } from "../../../../db/test-helpers";
import { createMinimalSession } from "../../../../db/test-fixtures";
import { SignalDeadLettersRepo } from "../signal-dead-letters-repo";
import { SignalEventsRepo } from "../signal-events-repo";
import { SignalSourcesRepo } from "../signal-sources-repo";

describe("SignalDeadLettersRepo", () => {
  it("inserts dead letters and marks them replayed", () => {
    const db = createTestDb();
    const repo = new SignalDeadLettersRepo(db);
    const eventsRepo = new SignalEventsRepo(db);
    const sourcesRepo = new SignalSourcesRepo(db);
    const session = createMinimalSession(db);
    const now = new Date().toISOString();

    sourcesRepo.create({
      id: "source-edgar",
      type: "edgar_8k",
      name: "EDGAR",
      description: null,
      enabled: true,
      configJson: "{}",
    });
    eventsRepo.insert({
      id: "event-1",
      sourceId: "source-edgar",
      sourceType: "edgar_8k",
      ticker: "AAPL",
      companyName: null,
      documentUrl: null,
      accessionNumber: "acc-1",
      payloadJson: {},
      filedAt: now,
      detectedAt: now,
      kind: "filing",
      dedupeKey: "acc-1",
      ttl: "PT6H",
      occurredAt: now,
    });

    const deadLetter = repo.insert({
      sessionId: session.id,
      signalEventId: "event-1",
      sourceId: "source-edgar",
      sourceType: "edgar_8k",
      ticker: "AAPL",
      instrumentClass: "stock",
      reason: "unsupported_by_experience",
      detail: { status: "draft" },
    });

    expect(repo.getById(deadLetter.id)?.reason).toBe(
      "unsupported_by_experience",
    );
    expect(repo.listBySessionFiltered({ sessionId: session.id })).toHaveLength(
      1,
    );

    const replayed = repo.markReplayed(deadLetter.id, "delivery-1");
    expect(replayed?.replayedAt).not.toBeNull();
    expect(replayed?.resolvedDeliveryId).toBe("delivery-1");

    db.sqlite.close();
  });
});
