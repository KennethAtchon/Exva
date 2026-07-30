import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../../../db/test-helpers";
import {
  brokerAccounts,
  orderIntents,
  paperCertificationRuns,
  sessions,
} from "../../../db/schema";
import { PaperCertificationService } from "../paper-certification-service";
import { MockBrokerAdapter } from "../../broker/adapters/mock-adapter";
import type { BrokerAdapter } from "../../broker/adapters/broker-adapter";

function seedPaperSession(db: ReturnType<typeof createTestDb>) {
  db.db
    .insert(sessions)
    .values({
      id: "sess-1",
      name: "Cert Session",
      objective: "test",
      status: "draft",
      executionMode: "paper_only",
      experienceId: "rules-mean-reversion",
      instrumentClasses: JSON.stringify(["stock"]),
      instrumentScope: "SPY",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .run();
  db.db
    .insert(brokerAccounts)
    .values({
      id: "broker-1",
      name: "Paper Alpaca",
      brokerType: "alpaca",
      supportedInstrumentClasses: JSON.stringify(["stock"]),
      mode: "paper",
      secretRef: "secret://test",
      updatedAt: new Date().toISOString(),
    })
    .run();
}

function certAdapter(
  placeOrderImpl?: ReturnType<typeof vi.fn>,
): BrokerAdapter {
  const inner = new MockBrokerAdapter({
    bias: "bullish",
    autoCloseAfterMs: 10,
  });
  const placeOrder = placeOrderImpl ?? vi.fn(inner.placeOrder.bind(inner));
  const orders = new Map<
    string,
    { brokerOrderId: string; filledQty: number; status: string }
  >();

  return {
    ...inner,
    testConnection: inner.testConnection.bind(inner),
    getAccountBalance: inner.getAccountBalance.bind(inner),
    getPositions: inner.getPositions.bind(inner),
    closeOrder: inner.closeOrder.bind(inner),
    prepareClientOrderId: (id: string) => `wire-${id}`,
    findOrderByClientOrderId: vi.fn(async (wireId: string) => {
      const hit = orders.get(wireId);
      if (!hit) return null;
      return {
        brokerOrderId: hit.brokerOrderId,
        status: hit.status,
        filledQty: hit.filledQty,
        filledAvgPrice: 450,
        rawStatus: hit.status,
      };
    }),
    placeOrder: vi.fn(async (order) => {
      const result = await placeOrder(order);
      orders.set(`wire-${order.clientOrderId ?? ""}`, {
        brokerOrderId: result.brokerOrderId,
        filledQty: 0.02,
        status: "filled",
      });
      return result;
    }),
    placeOrderV2: inner.placeOrderV2?.bind(inner),
  } as unknown as BrokerAdapter;
}

describe("PaperCertificationService restart resume", () => {
  it("does not duplicate entry submission after restart during submitting_entry", async () => {
    const db = createTestDb();
    seedPaperSession(db);
    const placeOrder = vi.fn(async () => ({
      brokerOrderId: "entry-1",
      filledAvgPrice: 450,
    }));
    const adapter = certAdapter(placeOrder);
    const svc = new PaperCertificationService({
      db,
      getAdapter: async () => adapter,
      isKillSwitchEngaged: () => false,
      getWorkspaceMode: () => "paper",
      now: () => new Date("2026-07-29T15:00:00.000Z"),
    });

    const run = await svc.arm({
      sessionId: "sess-1",
      brokerAccountId: "broker-1",
    });
    expect(placeOrder).toHaveBeenCalledTimes(1);

    // Simulate restart: reconcile without re-arming.
    const after = await svc.reconcile(run.id);
    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect(after.status).not.toBe("failed");
  });

  it("uses onConflictDoNothing for entry order intent on re-arm attempt", () => {
    const db = createTestDb();
    seedPaperSession(db);
    const now = new Date().toISOString();
    db.db
      .insert(paperCertificationRuns)
      .values({
        id: "run-dup",
        sessionId: "sess-1",
        brokerAccountId: "broker-1",
        status: "armed",
        entryClientOrderId: "cert-entry-run-dup",
        entryWireClientOrderId: "wire-cert-entry-run-dup",
        filledQuantity: 0,
        armedAt: now,
      })
      .run();
    db.db
      .insert(orderIntents)
      .values({
        id: "intent-1",
        sessionId: "sess-1",
        originKind: "certification",
        brokerAccountId: "broker-1",
        canonicalClientOrderId: "cert-entry-run-dup",
        wireClientOrderId: "wire-cert-entry-run-dup",
        status: "created",
        side: "BUY",
        symbol: "SPY",
        notionalUsd: 10,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    expect(() =>
      db.db
        .insert(orderIntents)
        .values({
          id: "intent-2",
          sessionId: "sess-1",
          originKind: "certification",
          brokerAccountId: "broker-1",
          canonicalClientOrderId: "cert-entry-run-dup",
          wireClientOrderId: "wire-cert-entry-run-dup",
          status: "created",
          side: "BUY",
          symbol: "SPY",
          notionalUsd: 10,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run(),
    ).not.toThrow();

    const rows = db.db.select().from(orderIntents).all();
    expect(rows).toHaveLength(1);
  });

  it("resumes exit reconciliation without duplicate exit placement", async () => {
    const db = createTestDb();
    seedPaperSession(db);
    const exitPlace = vi.fn(async (_order?: unknown) => ({
      brokerOrderId: "exit-1",
      filledAvgPrice: 451,
    }));
    const adapter = certAdapter();
    if (adapter.placeOrderV2) {
      adapter.placeOrderV2 = vi.fn(async (order) => {
        if (order.side === "SELL") {
          return exitPlace(order as never);
        }
        return { brokerOrderId: "entry-1", filledAvgPrice: 450 };
      }) as typeof adapter.placeOrderV2;
    }
    adapter.findOrderByClientOrderId = vi.fn(async (wireId: string) => ({
      brokerOrderId: "exit-1",
      status: "filled",
      filledQty: 0.02,
      filledAvgPrice: 451,
      rawStatus: "filled",
    }));

    const svc = new PaperCertificationService({
      db,
      getAdapter: async () => adapter,
      isKillSwitchEngaged: () => false,
      getWorkspaceMode: () => "paper",
      now: () => new Date("2026-07-29T15:00:00.000Z"),
    });

    const now = new Date().toISOString();
    db.db
      .insert(paperCertificationRuns)
      .values({
        id: "run-exit",
        sessionId: "sess-1",
        brokerAccountId: "broker-1",
        status: "exit_open",
        entryClientOrderId: "cert-entry-run-exit",
        entryWireClientOrderId: "wire-cert-entry-run-exit",
        entryBrokerOrderId: "entry-1",
        exitClientOrderId: "cert-exit-run-exit",
        exitWireClientOrderId: "wire-cert-exit-run-exit",
        exitBrokerOrderId: "exit-1",
        filledQuantity: 0.02,
        armedAt: now,
      })
      .run();

    await svc.reconcile("run-exit");
    expect(exitPlace).not.toHaveBeenCalled();
  });
});
