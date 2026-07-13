import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerExperience } from "../../../experiences/index";
import { RULES_MEAN_REVERSION_EXPERIENCE } from "../../../experiences/rules-mean-reversion/descriptor";
import "../../../experiences/index";
import { createTestDb } from "../../../db/test-helpers";
import { BrokerAccountsRepo } from "../../../db/repositories/brokers/broker-accounts-repo";
import { BrokerRoutingRepo } from "../../../db/repositories/brokers/broker-routing-repo";
import { SessionBrokerAssignmentsRepo } from "../../../db/repositories/sessions/session-broker-assignments-repo";
import { SessionRepo } from "../../../db/repositories/sessions/session-repo";
import { SignalSourcesRepo } from "../repos/signal-sources-repo";
import { SignalEventsRepo } from "../repos/signal-events-repo";
import { SignalDeliveriesRepo } from "../repos/signal-deliveries-repo";
import { SignalDeadLettersRepo } from "../repos/signal-dead-letters-repo";
import { SignalBus } from "../signal-bus";
import { SignalService } from "../signal-service";
import { BrokerRoutingService } from "../../broker/broker-routing-service";
import { BrokerRegistry } from "../../broker/broker-registry";
import { InstrumentNormalizer } from "../../broker/instrument-normalizer";
import { EventBus } from "../../infra/event-bus";

describe("SignalService replayDeadLetter", () => {
  let db = createTestDb();

  beforeAll(() => {
    try {
      registerExperience({
        ...RULES_MEAN_REVERSION_EXPERIENCE,
        id: "test-multi-class-rules",
        displayName: "Test multi-class rules",
        capabilities: {
          signalSourceTypes: [],
          brokerRequirement: "any_supported_class",
        },
        acceptsScanHit: true,
      });
    } catch {
      // already registered in this worker
    }
  });

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.sqlite.close();
  });

  it("replays a dead letter after broker coverage is added", async () => {
    const brokerAccounts = new BrokerAccountsRepo(db);
    brokerAccounts.insert({
      id: "broker-futures",
      name: "Futures",
      brokerType: "mock",
      supportedInstrumentClasses: ["futures"],
      mode: "paper",
      secretRef: "secret",
    });

    const sessions = new SessionRepo(db);
    const session = sessions.create({
      name: "Replay Session",
      objective: "Replay test",
      selectionMode: "manual_shortlist",
      instrumentClasses: ["stock", "futures"],
      instrumentScope: "ES",
      executionMode: "paper_only",
      experienceId: "test-multi-class-rules",
    });

    const assignments = new SessionBrokerAssignmentsRepo(db);
    assignments.replaceAssignments(session.id, [
      { brokerAccountId: "broker-futures", allocatedUsd: 1000 },
    ]);

    // signal_events.source_id is an FK to signal_sources, so the source must
    // exist before the event (and its dead letter) can be inserted.
    const sourcesRepo = new SignalSourcesRepo(db);
    sourcesRepo.create({
      id: "mock-source",
      type: "mock",
      name: "Mock Source",
      description: null,
      enabled: true,
      configJson: "{}",
    });

    const eventsRepo = new SignalEventsRepo(db);
    const now = new Date().toISOString();
    const signal = {
      id: crypto.randomUUID(),
      sourceId: "mock-source",
      sourceType: "mock" as const,
      ticker: "ES",
      companyName: null,
      documentUrl: null,
      accessionNumber: null,
      payloadJson: {
        instrumentClass: "futures",
        kind: "scan_hit",
        cadence: "15m",
      },
      kind: "scan_hit",
      filedAt: now,
      detectedAt: now,
      dedupeKey: `scan_hit:${crypto.randomUUID()}`,
      ttl: "PT1H",
      occurredAt: now,
    };
    eventsRepo.insert(signal);

    const deadLettersRepo = new SignalDeadLettersRepo(db);
    const deadLetter = deadLettersRepo.insert({
      sessionId: session.id,
      signalEventId: signal.id,
      sourceId: signal.sourceId,
      sourceType: signal.sourceType,
      ticker: signal.ticker,
      instrumentClass: "futures",
      reason: "unsupported_by_assigned_broker",
      detail: { instrumentClass: "futures" },
    });

    const deliveriesRepo = new SignalDeliveriesRepo(db);
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
    const bus = new SignalBus(
      eventsRepo,
      deliveriesRepo,
      deadLettersRepo,
      sessions,
      assignments,
      brokerAccounts,
      routing,
      new EventBus(),
      new InstrumentNormalizer(),
    );
    const service = new SignalService(
      new SignalSourcesRepo(db),
      eventsRepo,
      deliveriesRepo,
      deadLettersRepo,
      {
        create: () => {
          throw new Error("not used");
        },
      } as never,
      bus,
    );

    const replay = await service.replayDeadLetter(deadLetter.id);
    expect(replay.deliveryId).toBeTruthy();
    const updated = deadLettersRepo.getById(deadLetter.id);
    expect(updated?.replayedAt).toBeTruthy();
    expect(updated?.resolvedDeliveryId).toBe(replay.deliveryId);
  });
});
