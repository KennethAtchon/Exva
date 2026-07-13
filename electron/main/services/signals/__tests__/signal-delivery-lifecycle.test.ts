import { describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import { createMinimalSession } from "../../../db/test-fixtures";
import { EventBus } from "../../infra/event-bus";
import { SignalDeliveryLifecycle } from "../signal-delivery-lifecycle";
import { completeSignalDeliveryFromContext } from "../complete-signal-delivery";
import { SignalDeliveriesRepo } from "../repos/signal-deliveries-repo";
import { SignalEventsRepo } from "../repos/signal-events-repo";
import { SignalSourcesRepo } from "../repos/signal-sources-repo";

function insertFixtureSignal(
  sourcesRepo: SignalSourcesRepo,
  eventsRepo: SignalEventsRepo,
  partial: {
    id: string;
    sourceId: string;
    ticker?: string;
  },
) {
  if (!sourcesRepo.get(partial.sourceId)) {
    sourcesRepo.create({
      id: partial.sourceId,
      type: "manual",
      name: "Fixture Source",
      description: null,
      enabled: true,
      configJson: "{}",
    });
  }
  eventsRepo.insert({
    id: partial.id,
    sourceId: partial.sourceId,
    sourceType: "manual",
    ticker: partial.ticker ?? "AAPL",
    companyName: null,
    documentUrl: null,
    accessionNumber: null,
    payloadJson: { instrumentClass: "stock" },
    filedAt: new Date().toISOString(),
    detectedAt: new Date().toISOString(),
    kind: "manual",
    dedupeKey: `manual:${partial.id}`,
    ttl: "PT4H",
    occurredAt: new Date().toISOString(),
  });
}

describe("SignalDeliveryLifecycle", () => {
  it("completes queued deliveries and emits bus updates", () => {
    const db = createTestDb();
    const session = createMinimalSession(db);
    const eventsRepo = new SignalEventsRepo(db);
    const deliveriesRepo = new SignalDeliveriesRepo(db);
    const sourcesRepo = new SignalSourcesRepo(db);
    const eventBus = new EventBus();
    const emitted: unknown[] = [];
    eventBus.on("signal_delivery_updated", (payload) => emitted.push(payload));

    const signalId = crypto.randomUUID();
    insertFixtureSignal(sourcesRepo, eventsRepo, {
      id: signalId,
      sourceId: "manual_source",
    });
    const delivery = deliveriesRepo.enqueue({
      sessionId: session.id,
      signalEventId: signalId,
      sourceId: "manual_source",
      queuePositionAtEnqueue: 1,
    });

    new SignalDeliveryLifecycle(deliveriesRepo, eventBus).complete(
      delivery.id,
      {
        sessionId: session.id,
        signalId,
        status: "traded",
        tradeId: "trade-1",
      },
    );

    const updated = deliveriesRepo.getDetailedById(delivery.id)?.delivery;
    expect(updated).toMatchObject({
      status: "traded",
      statusBucket: "completed",
      tradeId: "trade-1",
      finishedAt: expect.any(String),
    });
    expect(emitted[0]).toMatchObject({
      deliveryId: delivery.id,
      status: "traded",
      statusBucket: "completed",
    });
    db.sqlite.close();
  });

  it("expires processing deliveries when requested", () => {
    const db = createTestDb();
    const session = createMinimalSession(db);
    const eventsRepo = new SignalEventsRepo(db);
    const deliveriesRepo = new SignalDeliveriesRepo(db);
    const sourcesRepo = new SignalSourcesRepo(db);
    const lifecycle = new SignalDeliveryLifecycle(
      deliveriesRepo,
      new EventBus(),
    );

    const signalId = crypto.randomUUID();
    insertFixtureSignal(sourcesRepo, eventsRepo, {
      id: signalId,
      sourceId: "manual_source",
    });
    const delivery = deliveriesRepo.enqueueWithStatus({
      sessionId: session.id,
      signalEventId: signalId,
      sourceId: "manual_source",
      queuePositionAtEnqueue: 1,
      status: "processing",
      statusBucket: "pending",
    });

    lifecycle.expireIfStillProcessing(
      delivery.id,
      session.id,
      signalId,
      "selector_timeout",
    );

    expect(deliveriesRepo.getDetailedById(delivery.id)?.delivery.status).toBe(
      "expired",
    );
    db.sqlite.close();
  });
});

describe("completeSignalDeliveryFromContext", () => {
  it("delegates to signalDeliveryLifecycle when delivery ids is present", () => {
    const complete = vi.fn();
    const ctx = {
      sessionId: "session-1",
      deps: {
        signalDeliveryLifecycle: { complete },
      },
    } as never;

    completeSignalDeliveryFromContext(
      ctx,
      { signalDeliveryId: "delivery-1", signalId: "signal-1" },
      "rejected",
      { dropReason: "risk_gate" },
    );

    expect(complete).toHaveBeenCalledWith("delivery-1", {
      sessionId: "session-1",
      signalId: "signal-1",
      status: "rejected",
      tradeId: null,
      dropReason: "risk_gate",
    });
  });

  it("no-ops when delivery context is missing", () => {
    const complete = vi.fn();
    completeSignalDeliveryFromContext(
      {
        sessionId: "s1",
        deps: { signalDeliveryLifecycle: { complete } },
      } as never,
      { signalDeliveryId: undefined, signalId: "signal-1" },
      "dropped",
    );
    expect(complete).not.toHaveBeenCalled();
  });
});
