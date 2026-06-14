import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SignalEvent } from "@electron/shared/domain";
import { createTestDb } from "../../../db/test-helpers";
import {
  createMinimalSession,
  insertBrokerAccount,
} from "../../../db/test-fixtures";
import { BrokerAccountsRepo } from "../../../db/repositories/brokers/broker-accounts-repo";
import { BrokerRoutingRepo } from "../../../db/repositories/brokers/broker-routing-repo";
import { SessionBrokerAssignmentsRepo } from "../../../db/repositories/sessions/session-broker-assignments-repo";
import { SessionRepo } from "../../../db/repositories/sessions/session-repo";
import { BrokerRoutingService } from "../../broker/broker-routing-service";
import { BrokerRegistry } from "../../broker/broker-registry";
import { EventBus } from "../../infra/event-bus";
import { MockSignalSource } from "../sources/mock-signal-source";
import { SignalBus } from "../signal-bus";
import { SignalDeadLettersRepo } from "../repos/signal-dead-letters-repo";
import { SignalDeliveriesRepo } from "../repos/signal-deliveries-repo";
import { SignalEventsRepo } from "../repos/signal-events-repo";
import { SignalSourcesRepo } from "../repos/signal-sources-repo";

function stockSignal(
  sourceId: string,
  overrides?: Partial<SignalEvent>,
): SignalEvent {
  return {
    id: crypto.randomUUID(),
    sourceId,
    sourceType: "mock",
    ticker: "AAPL",
    companyName: "Apple Inc.",
    documentUrl: null,
    accessionNumber: null,
    payloadJson: { instrumentClass: "stock" },
    filedAt: new Date().toISOString(),
    detectedAt: new Date().toISOString(),
    ...overrides,
  };
}

function ensureManualSource(sourcesRepo: SignalSourcesRepo) {
  if (!sourcesRepo.get("manual_source")) {
    sourcesRepo.create({
      id: "manual_source",
      type: "manual",
      name: "Manual Source",
      description: null,
      enabled: true,
      configJson: "{}",
    });
  }
}

function createHarness(db: ReturnType<typeof createTestDb>) {
  const sessions = new SessionRepo(db);
  const session = createMinimalSession(db, {
    experienceId: "edgar-catalyst",
    instrumentScope: "AAPL",
  });
  insertBrokerAccount(db, { id: "broker-stock" });
  const assignments = new SessionBrokerAssignmentsRepo(db);
  assignments.replaceAssignments(session.id, [
    { brokerAccountId: "broker-stock", allocatedUsd: 1000 },
  ]);

  const brokerAccounts = new BrokerAccountsRepo(db);
  const routing = new BrokerRoutingService(
    brokerAccounts,
    assignments,
    new BrokerRoutingRepo(db),
    new BrokerRegistry(brokerAccounts, {
      get: async () => {
        throw new Error("not needed");
      },
    } as never),
  );

  const eventsRepo = new SignalEventsRepo(db);
  const deliveriesRepo = new SignalDeliveriesRepo(db);
  const deadLettersRepo = new SignalDeadLettersRepo(db);
  const sourcesRepo = new SignalSourcesRepo(db);
  ensureManualSource(sourcesRepo);
  const eventBus = new EventBus();

  const bus = new SignalBus(
    eventsRepo,
    deliveriesRepo,
    deadLettersRepo,
    sourcesRepo,
    sessions,
    assignments,
    brokerAccounts,
    routing,
    eventBus,
  );

  return {
    session,
    bus,
    eventsRepo,
    deliveriesRepo,
    deadLettersRepo,
    sourcesRepo,
    eventBus,
  };
}

describe("SignalBus", () => {
  let db = createTestDb();

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.sqlite.close();
  });

  it("fans out mock source signals to subscribed sessions", async () => {
    const { session, bus, eventsRepo, deliveriesRepo, sourcesRepo } =
      createHarness(db);
    const sourceRecord = sourcesRepo.create({
      id: "source-mock",
      type: "mock",
      name: "Mock",
      description: null,
      enabled: true,
      configJson: JSON.stringify({ ticker: "AAPL" }),
    });
    sourcesRepo.replaceSessionSubscriptions(session.id, [sourceRecord.id]);

    const source = new MockSignalSource(
      sourceRecord.id,
      sourceRecord.configJson,
    );
    bus.register(source);
    await source.test();

    expect(eventsRepo.listByDispatchStatus("fanned_out")).toHaveLength(1);
    const pending = deliveriesRepo.listBySessionFiltered({
      sessionId: session.id,
      statusBucket: "pending",
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]?.delivery.signalEventId).toBeTruthy();
  });

  it("dedupes events by source and accession number", async () => {
    const { bus, eventsRepo, sourcesRepo } = createHarness(db);
    const sourceRecord = sourcesRepo.create({
      id: "source-edgar",
      type: "edgar_8k",
      name: "EDGAR",
      description: null,
      enabled: true,
      configJson: "{}",
    });
    sourcesRepo.replaceSessionSubscriptions(createMinimalSession(db).id, [
      sourceRecord.id,
    ]);

    const duplicateEvent = stockSignal(sourceRecord.id, {
      accessionNumber: "0000320193-24-000001",
    });
    eventsRepo.insert(duplicateEvent);

    let handler: ((event: SignalEvent) => void) | undefined;
    const fakeSource = {
      id: sourceRecord.id,
      onSignal(h: (event: SignalEvent) => void) {
        handler = h;
      },
      offSignal() {},
    };
    bus.register(fakeSource as never);
    handler?.(duplicateEvent);

    expect(eventsRepo.listByDispatchStatus("fanned_out")).toHaveLength(0);
    expect(eventsRepo.listByDispatchStatus("new")).toHaveLength(1);
  });

  it("dead-letters signals when broker coverage is missing", async () => {
    const { session, bus, deadLettersRepo, eventsRepo } = createHarness(db);
    new SessionBrokerAssignmentsRepo(db).replaceAssignments(session.id, []);

    const signal = stockSignal("manual_source");
    eventsRepo.insert(signal);
    const result = await bus.deliverOrDeadLetter(session.id, signal);

    expect(result.kind).toBe("dead_letter");
    expect(
      deadLettersRepo.listBySessionFiltered({ sessionId: session.id }),
    ).toHaveLength(1);
  });

  it("injects manual tickers directly for a session", async () => {
    const { session, bus, eventsRepo, deliveriesRepo } = createHarness(db);

    bus.injectManual(
      stockSignal("manual_source", { ticker: "MSFT" }),
      session.id,
    );

    expect(eventsRepo.listByDispatchStatus("fanned_out")).toHaveLength(1);
    expect(
      deliveriesRepo.listBySessionFiltered({
        sessionId: session.id,
        statusBucket: "pending",
      }),
    ).toHaveLength(1);
  });
});
