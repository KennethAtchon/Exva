import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import { createMinimalSession } from "../../../db/test-fixtures";
import { EventBus } from "../../infra/event-bus";
import { SignalBus } from "../signal-bus";
import { InstrumentNormalizer } from "../../broker/instrument-normalizer";
import { SignalSourceRegistry } from "../signal-source-registry";
import { SignalService } from "../signal-service";
import { SignalDeadLettersRepo } from "../repos/signal-dead-letters-repo";
import { SignalDeliveriesRepo } from "../repos/signal-deliveries-repo";
import { SignalEventsRepo } from "../repos/signal-events-repo";
import { SignalSourcesRepo } from "../repos/signal-sources-repo";

describe("SignalService", () => {
  let db = createTestDb();

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.sqlite.close();
  });

  function createService() {
    const eventsRepo = new SignalEventsRepo(db);
    const deliveriesRepo = new SignalDeliveriesRepo(db);
    const deadLettersRepo = new SignalDeadLettersRepo(db);
    const sourcesRepo = new SignalSourcesRepo(db);
    const eventBus = new EventBus();
    const bus = new SignalBus(
      eventsRepo,
      deliveriesRepo,
      deadLettersRepo,
      {
        get: () => null,
        getStatus: () => "active",
      } as never,
      { listBrokerAccountIds: () => [] } as never,
      { get: () => null } as never,
      { resolveAdapter: async () => ({ adapter: {} }) } as never,
      eventBus,
      new InstrumentNormalizer(),
    );
    const registry = new SignalSourceRegistry(db, bus);
    const service = new SignalService(
      sourcesRepo,
      eventsRepo,
      deliveriesRepo,
      deadLettersRepo,
      registry,
      bus,
    );
    return { service, sourcesRepo, registry, deliveriesRepo, eventBus };
  }

  it("creates, updates, and deletes signal sources", async () => {
    const { service, sourcesRepo, registry } = createService();

    const created = await service.createSource({
      type: "mock",
      name: "Fixture Mock",
      config: { ticker: "NVDA" },
    });
    expect(sourcesRepo.get(created.id)?.name).toBe("Fixture Mock");
    expect(registry.status(created.id)?.status).toBe("running");

    await service.updateSource(created.id, {
      name: "Updated Mock",
      enabled: false,
    });
    expect(registry.status(created.id)?.status).toBe("paused");

    await service.deleteSource(created.id);
    expect(sourcesRepo.get(created.id)).toBeNull();
  });

  it("derives session readiness from subscriptions and manual scope", () => {
    const { service } = createService();
    // V2: readiness is based on instrumentScope only (legacy session_signal_sources removed).
    expect(service.deriveReadiness("any-session", "AAPL,MSFT")).toBe(
      "manual_only",
    );
    expect(service.deriveReadiness("any-session", "")).toBe("no_inputs");
  });

  it("bootstraps manual source and replays paused deliveries on resume", async () => {
    const { service, sourcesRepo, deliveriesRepo } = createService();
    service.bootstrapFromDb();
    expect(sourcesRepo.get("manual_source")?.type).toBe("manual");

    const session = createMinimalSession(db);
    const eventId = crypto.randomUUID();
    const now = new Date().toISOString();
    new SignalEventsRepo(db).insert({
      id: eventId,
      sourceId: "manual_source",
      sourceType: "manual",
      ticker: "AAPL",
      companyName: null,
      documentUrl: null,
      accessionNumber: null,
      payloadJson: { instrumentClass: "stock" },
      filedAt: now,
      detectedAt: now,
      kind: "manual",
      dedupeKey: `manual:${eventId}`,
      ttl: "PT4H",
      occurredAt: now,
    });
    const delivery = deliveriesRepo.enqueueWithStatus({
      sessionId: session.id,
      signalEventId: eventId,
      sourceId: "manual_source",
      queuePositionAtEnqueue: 1,
      status: "waiting_for_resume",
      statusBucket: "pending",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    service.onSessionResumed(session.id);
    expect(deliveriesRepo.getDetailedById(delivery.id)?.delivery.status).toBe(
      "queued",
    );
  });
});
