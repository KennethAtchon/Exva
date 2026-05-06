import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "../../../db/test-helpers";
import { BrokerAccountsRepo } from "../../../db/repositories/broker-accounts-repo";
import { BrokerRoutingRepo } from "../../../db/repositories/broker-routing-repo";
import { SessionBrokerAssignmentsRepo } from "../../../db/repositories/session-broker-assignments-repo";
import { SessionRepo } from "../../../db/repositories/session-repo";
import { BrokerRoutingService } from "../broker-routing-service";

describe("BrokerRoutingService", () => {
  let db = createTestDb();

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.sqlite.close();
  });

  it("prefers a session override over the workspace default", () => {
    const { sessionId, brokers, assignments, routingRepo } = createRoutingContext(db, ["stock"]);
    brokers.insert({
      id: "stock-default",
      name: "Default Stock Broker",
      brokerType: "mock",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
      secretRef: "broker:stock-default",
    });
    brokers.insert({
      id: "stock-override",
      name: "Override Stock Broker",
      brokerType: "mock",
      supportedInstrumentClasses: ["stock"],
      mode: "live",
      secretRef: "broker:stock-override",
    });
    assignments.replaceAssignments(sessionId, ["stock-default", "stock-override"]);
    routingRepo.upsertGlobalDefaults([{ instrumentClass: "stock", defaultBrokerAccountId: "stock-default" }]);
    routingRepo.upsertSessionOverrides(sessionId, [{ instrumentClass: "stock", brokerAccountId: "stock-override" }]);

    const service = createService(db);
    expect(service.resolveBrokerAccountId(sessionId, "stock")).toBe("stock-override");
  });

  it("falls back to the single compatible assignment when no route is configured", () => {
    const { sessionId, brokers, assignments } = createRoutingContext(db, ["crypto"]);
    brokers.insert({
      id: "crypto-only",
      name: "Crypto Only",
      brokerType: "mock",
      supportedInstrumentClasses: ["crypto"],
      mode: "paper",
      secretRef: "broker:crypto-only",
    });
    assignments.replaceAssignments(sessionId, ["crypto-only"]);

    const service = createService(db);
    expect(service.resolveBrokerAccountId(sessionId, "crypto")).toBe("crypto-only");
  });

  it("throws when multiple compatible brokers exist with no routing default", () => {
    const { sessionId, brokers, assignments } = createRoutingContext(db, ["stock"]);
    brokers.insert({
      id: "stock-a",
      name: "Stock A",
      brokerType: "mock",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
      secretRef: "broker:stock-a",
    });
    brokers.insert({
      id: "stock-b",
      name: "Stock B",
      brokerType: "mock",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
      secretRef: "broker:stock-b",
    });
    assignments.replaceAssignments(sessionId, ["stock-a", "stock-b"]);

    const service = createService(db);
    expect(() => service.resolveBrokerAccountId(sessionId, "stock")).toThrow(/multiple brokers are compatible/i);
  });

  it("rejects routed brokers that are not assigned to the session", () => {
    const { sessionId, brokers, assignments, routingRepo } = createRoutingContext(db, ["stock"]);
    brokers.insert({
      id: "assigned-stock",
      name: "Assigned Stock",
      brokerType: "mock",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
      secretRef: "broker:assigned-stock",
    });
    brokers.insert({
      id: "unassigned-stock",
      name: "Unassigned Stock",
      brokerType: "mock",
      supportedInstrumentClasses: ["stock"],
      mode: "live",
      secretRef: "broker:unassigned-stock",
    });
    assignments.replaceAssignments(sessionId, ["assigned-stock"]);
    routingRepo.upsertGlobalDefaults([{ instrumentClass: "stock", defaultBrokerAccountId: "unassigned-stock" }]);

    const service = createService(db);
    expect(() => service.resolveBrokerAccountId(sessionId, "stock")).toThrow(/not assigned to this session/i);
  });

  it("fails preflight when an assigned broker test connection fails", async () => {
    const { sessionId, brokers, assignments } = createRoutingContext(db, ["stock"]);
    brokers.insert({
      id: "failing-stock",
      name: "Failing Stock",
      brokerType: "mock",
      supportedInstrumentClasses: ["stock"],
      mode: "paper",
      secretRef: "broker:failing-stock",
    });
    assignments.replaceAssignments(sessionId, ["failing-stock"]);

    const service = createService(db, {
      async get(id: string) {
        return {
          testConnection: async () =>
            id === "failing-stock"
              ? { ok: false as const, message: "broker offline" }
              : { ok: true as const, message: "ok", account_balance: 1000 },
        };
      },
    });

    await expect(service.preflightSession(sessionId, ["stock"])).rejects.toMatchObject({
      code: "BROKER_UNREACHABLE",
    });
  });
});

function createRoutingContext(
  db: ReturnType<typeof createTestDb>,
  instrumentClasses: Array<"stock" | "crypto" | "futures" | "prediction_market">,
) {
  const sessions = new SessionRepo(db);
  const sessionId = sessions.create({
    name: "Routing Session",
    objective: "Route instruments",
    selectionMode: "manual_shortlist",
    instrumentClasses,
    instrumentScope: "AAPL",
    capitalLimitUsd: 5000,
    executionMode: "paper_only",
  }).id;

  return {
    sessionId,
    brokers: new BrokerAccountsRepo(db),
    assignments: new SessionBrokerAssignmentsRepo(db),
    routingRepo: new BrokerRoutingRepo(db),
  };
}

function createService(
  db: ReturnType<typeof createTestDb>,
  registry: { get(id: string): Promise<{ testConnection(): Promise<{ ok: boolean; message: string; account_balance?: number }> }> } = {
    async get() {
      return {
        testConnection: async () => ({ ok: true, message: "ok", account_balance: 1000 }),
      };
    },
  },
) {
  return new BrokerRoutingService(
    new BrokerAccountsRepo(db),
    new SessionBrokerAssignmentsRepo(db),
    new BrokerRoutingRepo(db),
    registry as never,
  );
}
