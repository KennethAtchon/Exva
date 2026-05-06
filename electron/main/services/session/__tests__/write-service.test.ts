import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import { BrokerAccountsRepo } from "../../../db/repositories/broker-accounts-repo";
import { BrokerRoutingRepo } from "../../../db/repositories/broker-routing-repo";
import { EventsRepo } from "../../../db/repositories/events-repo";
import { SessionBrokerAssignmentsRepo } from "../../../db/repositories/session-broker-assignments-repo";
import { SessionRepo } from "../../../db/repositories/session-repo";
import { SessionSelectorSettingsRepo } from "../../../db/repositories/session-selector-settings-repo";
import { SessionWriteService } from "../write-service";

describe("SessionWriteService", () => {
  let db = createTestDb();

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.sqlite.close();
  });

  it("creates a focused session with broker assignments and routing overrides", () => {
    const service = createService(db);
    insertBroker(db, {
      id: "broker-stock",
      name: "Stock Mock",
      brokerType: "mock",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
    });
    insertBroker(db, {
      id: "broker-crypto",
      name: "Crypto Mock",
      brokerType: "mock",
      supportedInstrumentClasses: ["crypto"],
      mode: "live",
    });

    const result = service.create({
      name: "Dual Market Session",
      objective: "Trade both stocks and crypto",
      selectionMode: "manual_shortlist",
      instrumentClasses: ["stock", "crypto"],
      instrumentScope: "NVDA, BTC-USD",
      selectorSettings: { aiPickerEnabled: false },
      capitalLimitUsd: 5000,
      executionMode: "live_allowed",
      brokerAccountIds: ["broker-stock", "broker-crypto"],
      brokerOverridesByInstrumentClass: {
        stock: "broker-stock",
        crypto: "broker-crypto",
      },
    });

    const sessions = new SessionRepo(db);
    const assignments = new SessionBrokerAssignmentsRepo(db);
    const routing = new BrokerRoutingRepo(db);
    const selectorSettings = new SessionSelectorSettingsRepo(db);

    expect(result.status).toBe("draft");
    expect(sessions.getFocusedSessionId()).toBe(result.id);
    expect(assignments.listBrokerAccountIds(result.id)).toEqual(["broker-crypto", "broker-stock"]);
    expect(routing.listSessionOverrides(result.id)).toEqual([
      { sessionId: result.id, instrumentClass: "crypto", brokerAccountId: "broker-crypto" },
      { sessionId: result.id, instrumentClass: "stock", brokerAccountId: "broker-stock" },
    ]);
    expect(selectorSettings.get(result.id).aiPickerEnabled).toBe(false);
  });

  it("rejects broker assignments that do not support the session instrument classes", () => {
    const service = createService(db);
    insertBroker(db, {
      id: "broker-stock",
      name: "Stock Only",
      brokerType: "alpaca",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
    });

    expect(() =>
      service.create({
        name: "Crypto Session",
        objective: "Trade BTC",
        selectionMode: "manual_shortlist",
        instrumentClasses: ["crypto"],
        instrumentScope: "BTC-USD",
        selectorSettings: { aiPickerEnabled: false },
        capitalLimitUsd: 2500,
        executionMode: "paper_only",
        brokerAccountIds: ["broker-stock"],
      }),
    ).toThrowError(/does not support any of the selected instrument classes/i);
  });
});

function createService(db: ReturnType<typeof createTestDb>): SessionWriteService {
  return new SessionWriteService({
    sessions: new SessionRepo(db),
    events: new EventsRepo(db),
    selectorSettings: new SessionSelectorSettingsRepo(db),
    assignments: new SessionBrokerAssignmentsRepo(db),
    brokerRouting: new BrokerRoutingRepo(db),
    brokerAccounts: new BrokerAccountsRepo(db),
  });
}

function insertBroker(
  db: ReturnType<typeof createTestDb>,
  input: {
    id: string;
    name: string;
    brokerType: string;
    supportedInstrumentClasses: Array<"stock" | "crypto" | "futures" | "prediction_market">;
    mode: "paper" | "live";
  },
): void {
  new BrokerAccountsRepo(db).insert({
    ...input,
    secretRef: `broker:${input.id}`,
  });
}
