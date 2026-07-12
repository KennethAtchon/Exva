import { beforeAll, describe, expect, it } from "vitest";
import type { SignalEvent } from "@electron/shared/domain";
import { registerExperience } from "../../../experiences/index";
import { RULES_MEAN_REVERSION_EXPERIENCE } from "../../../experiences/rules-mean-reversion/descriptor";
import { createTestDb } from "../../../db/test-helpers";
import { BrokerAccountsRepo } from "../../../db/repositories/brokers/broker-accounts-repo";
import { BrokerRoutingRepo } from "../../../db/repositories/brokers/broker-routing-repo";
import { SessionBrokerAssignmentsRepo } from "../../../db/repositories/sessions/session-broker-assignments-repo";
import { SessionRepo } from "../../../db/repositories/sessions/session-repo";
import { BrokerRoutingService } from "../../broker/broker-routing-service";
import { BrokerRegistry } from "../../broker/broker-registry";
import { evaluateSignalDeliveryGate } from "../signal-delivery-gate";

function stockSignal(overrides?: Partial<SignalEvent>): SignalEvent {
  return {
    id: crypto.randomUUID(),
    sourceId: "source-1",
    sourceType: "edgar_8k",
    ticker: "NVDA",
    companyName: "NVIDIA",
    documentUrl: null,
    accessionNumber: "acc-1",
    payloadJson: { instrumentClass: "stock" },
    filedAt: new Date().toISOString(),
    detectedAt: new Date().toISOString(),
    ...overrides,
  };
}

function scanHitSignal(overrides?: Partial<SignalEvent>): SignalEvent {
  return stockSignal({
    sourceType: "timer",
    kind: "scan_hit",
    payloadJson: {
      instrumentClass: "stock",
      kind: "scan_hit",
      strategyId: "mean-reversion",
    },
    ...overrides,
  });
}

describe("evaluateSignalDeliveryGate", () => {
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
        signals: [],
        schedules: [
          {
            id: "es-15m-test",
            instrumentClass: "stock",
            symbol: "ES",
            cadence: "15m",
            defaultAnalysisTimeframe: "1h",
            enabledByDefault: true,
            mockFixtures: {
              defaultScenario: "clean_breakout",
              scriptedWorkerOutputs: {},
            },
          },
        ],
      });
    } catch {
      // already registered in this worker
    }
  });

  it("accepts compatible EDGAR stock signals", () => {
    const db = createTestDb();
    const brokerAccounts = new BrokerAccountsRepo(db);
    brokerAccounts.insert({
      id: "broker-stock",
      name: "Stock",
      brokerType: "mock",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
      secretRef: "secret",
    });
    const sessions = new SessionRepo(db);
    const session = sessions.create({
      name: "Gate Session",
      objective: "Test",
      selectionMode: "manual_shortlist",
      instrumentClasses: ["stock"],
      instrumentScope: "NVDA",
      executionMode: "paper_only",
      experienceId: "edgar-catalyst",
    });
    const assignments = new SessionBrokerAssignmentsRepo(db);
    assignments.replaceAssignments(session.id, [
      { brokerAccountId: "broker-stock", allocatedUsd: 1000 },
    ]);
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

    const result = evaluateSignalDeliveryGate({
      sessionId: session.id,
      experienceId: "edgar-catalyst",
      signal: stockSignal(),
      brokerAssignments: ["broker-stock"],
      brokerAccounts,
      brokerRouting: routing,
    });

    expect(result.ok).toBe(true);
    db.sqlite.close();
  });

  it("accepts scan_hit when experience has schedules", () => {
    const db = createTestDb();
    const brokerAccounts = new BrokerAccountsRepo(db);
    brokerAccounts.insert({
      id: "broker-stock",
      name: "Stock",
      brokerType: "mock",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
      secretRef: "secret",
    });
    const sessions = new SessionRepo(db);
    const session = sessions.create({
      name: "Rules Session",
      objective: "Test",
      selectionMode: "manual_shortlist",
      instrumentClasses: ["stock"],
      instrumentScope: "SPY",
      executionMode: "paper_only",
      experienceId: "rules-mean-reversion",
    });
    const assignments = new SessionBrokerAssignmentsRepo(db);
    assignments.replaceAssignments(session.id, [
      { brokerAccountId: "broker-stock", allocatedUsd: 1000 },
    ]);
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

    const result = evaluateSignalDeliveryGate({
      sessionId: session.id,
      experienceId: "rules-mean-reversion",
      signal: scanHitSignal({ ticker: "SPY" }),
      brokerAssignments: ["broker-stock"],
      brokerAccounts,
      brokerRouting: routing,
    });

    expect(result.ok).toBe(true);
    db.sqlite.close();
  });

  it("dead-letters prediction_market scan_hit when only a stock broker is assigned", () => {
    const db = createTestDb();
    const brokerAccounts = new BrokerAccountsRepo(db);
    brokerAccounts.insert({
      id: "broker-stock",
      name: "Stock",
      brokerType: "mock",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
      secretRef: "secret",
    });
    const sessions = new SessionRepo(db);
    const session = sessions.create({
      name: "Rules Session",
      objective: "Test",
      selectionMode: "manual_shortlist",
      instrumentClasses: ["stock"],
      instrumentScope: "SPY",
      executionMode: "paper_only",
      experienceId: "rules-mean-reversion",
    });
    const assignments = new SessionBrokerAssignmentsRepo(db);
    assignments.replaceAssignments(session.id, [
      { brokerAccountId: "broker-stock", allocatedUsd: 1000 },
    ]);
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

    const result = evaluateSignalDeliveryGate({
      sessionId: session.id,
      experienceId: "rules-mean-reversion",
      signal: scanHitSignal({
        payloadJson: {
          instrumentClass: "prediction_market",
          kind: "scan_hit",
          cadence: "15m",
        },
      }),
      brokerAssignments: ["broker-stock"],
      brokerAccounts,
      brokerRouting: routing,
    });

    expect(result).toEqual({
      ok: false,
      reason: "unsupported_by_assigned_broker",
      detail: expect.objectContaining({
        instrumentClass: "prediction_market",
      }),
    });
    db.sqlite.close();
  });

  it("dead-letters futures scan_hit when only a stock broker is assigned", () => {
    const db = createTestDb();
    const brokerAccounts = new BrokerAccountsRepo(db);
    brokerAccounts.insert({
      id: "broker-stock",
      name: "Stock",
      brokerType: "mock",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
      secretRef: "secret",
    });
    const sessions = new SessionRepo(db);
    const session = sessions.create({
      name: "Multi-class Session",
      objective: "Test",
      selectionMode: "manual_shortlist",
      instrumentClasses: ["stock", "futures"],
      instrumentScope: "ES",
      executionMode: "paper_only",
      experienceId: "test-multi-class-rules",
    });
    const assignments = new SessionBrokerAssignmentsRepo(db);
    assignments.replaceAssignments(session.id, [
      { brokerAccountId: "broker-stock", allocatedUsd: 1000 },
    ]);
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

    const result = evaluateSignalDeliveryGate({
      sessionId: session.id,
      experienceId: "test-multi-class-rules",
      signal: scanHitSignal({
        ticker: "ES",
        payloadJson: {
          instrumentClass: "futures",
          kind: "scan_hit",
          cadence: "15m",
        },
      }),
      brokerAssignments: ["broker-stock"],
      brokerAccounts,
      brokerRouting: routing,
    });

    expect(result).toEqual({
      ok: false,
      reason: "unsupported_by_assigned_broker",
      detail: expect.objectContaining({ instrumentClass: "futures" }),
    });
    db.sqlite.close();
  });
});
