import { describe, expect, it } from "vitest";
import { createTestDb } from "../../../../db/test-helpers";
import { createMinimalSession } from "../../../../db/test-fixtures";
import { SignalDeliveriesRepo } from "../signal-deliveries-repo";
import { SignalEventsRepo } from "../signal-events-repo";
import { SignalSourcesRepo } from "../signal-sources-repo";

describe("SignalDeliveriesRepo", () => {
  it("enqueues deliveries and updates status", () => {
    const db = createTestDb();
    const deliveriesRepo = new SignalDeliveriesRepo(db);
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
    });

    const delivery = deliveriesRepo.enqueue({
      sessionId: session.id,
      signalEventId: "event-1",
      sourceId: "source-edgar",
      queuePositionAtEnqueue: deliveriesRepo.nextQueuePosition(session.id),
    });

    expect(delivery.status).toBe("queued");
    expect(deliveriesRepo.listBySession(session.id)).toHaveLength(1);

    deliveriesRepo.updateStatus(delivery.id, {
      status: "processing",
      statusBucket: "pending",
      startedAt: now,
    });
    expect(
      deliveriesRepo.listBySessionAndStatus(session.id, "processing"),
    ).toHaveLength(1);

    db.sqlite.close();
  });
});
