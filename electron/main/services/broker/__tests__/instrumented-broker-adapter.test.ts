import { describe, expect, it, vi } from "vitest";
import type { ApiCallLogRepo } from "../../../db/repositories/system/api-call-log-repo";
import {
  isMarketDiscoveryAdapter,
  type BrokerAdapter,
  type MarketDiscoveryAdapter,
} from "../adapters/broker-adapter";
import { createInstrumentedBrokerAdapter } from "../instrumented-broker-adapter";

function createMockAdapter(
  overrides: Partial<BrokerAdapter> = {},
): BrokerAdapter {
  return {
    brokerType: "mock",
    supportedInstrumentClasses: ["stock"],
    launchCapable: true,
    testConnection: vi.fn(async () => ({ ok: true, message: "ok" })),
    placeOrder: vi.fn(async () => ({
      brokerOrderId: "order-1",
      filledAvgPrice: 100,
    })),
    cancelOrder: vi.fn(async () => undefined),
    getPositions: vi.fn(async () => []),
    getAccountBalance: vi.fn(async () => 10_000),
    getMarketSnapshot: vi.fn(async (symbol: string) => ({
      instrumentSymbol: symbol,
      price: 101,
      timestamp: new Date().toISOString(),
    })),
    getOrderStatus: vi.fn(async (orderId: string) => ({
      brokerOrderId: orderId,
      status: "open" as const,
      latestPrice: 101,
      realizedPnlUsd: null,
    })),
    closeOrder: vi.fn(async (orderId: string) => ({
      brokerOrderId: orderId,
      realizedPnlUsd: 0,
    })),
    getOhlcv: vi.fn(async () => [
      {
        ts: "2026-01-01T00:00:00.000Z",
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 100,
      },
    ]),
    ...overrides,
  };
}

describe("createInstrumentedBrokerAdapter", () => {
  it("logs successful broker calls with scope and endpoint metadata", async () => {
    const inserts: unknown[] = [];
    const apiCallLogRepo = {
      insert: (entry: unknown) => inserts.push(entry),
    } as unknown as ApiCallLogRepo;
    const inner = createMockAdapter();
    const adapter = createInstrumentedBrokerAdapter(inner, {
      apiCallLogRepo,
      brokerAccountId: "broker-1",
      provider: "alpaca",
    });

    await adapter.placeOrder({
      instrumentSymbol: "SPY",
      instrumentDisplayName: null,
      predictionOutcome: null,
      instrumentMetadataJson: null,
      instrumentType: "stock",
      side: "BUY",
      sizeUsd: 500,
      clientOrderId: "client-1",
    });
    await adapter.getMarketSnapshot("SPY");
    await adapter.getMarketSnapshot("pm:cond-1", {
      predictionOutcome: "NO",
    });

    expect(inner.placeOrder).toHaveBeenCalledTimes(1);
    expect(inner.getMarketSnapshot).toHaveBeenNthCalledWith(
      1,
      "SPY",
      undefined,
    );
    expect(inner.getMarketSnapshot).toHaveBeenNthCalledWith(2, "pm:cond-1", {
      predictionOutcome: "NO",
    });
    expect(inserts).toHaveLength(3);
    expect(inserts[0]).toMatchObject({
      call_type: "placeOrder",
      endpoint: "broker-1/placeOrder/BUY/SPY/stock/$500.00/client-1",
      status: "ok",
    });
    expect(inserts[1]).toMatchObject({
      call_type: "getMarketSnapshot",
      endpoint: "broker-1/SPY",
      status: "ok",
    });
    expect(inserts[2]).toMatchObject({
      call_type: "getMarketSnapshot",
      endpoint: "broker-1/pm:cond-1/NO",
      status: "ok",
    });
  });

  it("logs failed broker calls with error status", async () => {
    const inserts: unknown[] = [];
    const apiCallLogRepo = {
      insert: (entry: unknown) => inserts.push(entry),
    } as unknown as ApiCallLogRepo;
    const inner = createMockAdapter({
      getAccountBalance: vi.fn(async () => {
        throw new Error("broker down");
      }),
    });
    const adapter = createInstrumentedBrokerAdapter(inner, {
      apiCallLogRepo,
      brokerAccountId: "broker-1",
      provider: "alpaca",
    });

    await expect(adapter.getAccountBalance()).rejects.toThrow("broker down");
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      call_type: "getAccountBalance",
      endpoint: "broker-1/balance",
      status: "error",
    });
  });

  it("logs getOhlcv as empty/partial when returned bars are below the request", async () => {
    const inserts: unknown[] = [];
    const apiCallLogRepo = {
      insert: (entry: unknown) => inserts.push(entry),
    } as unknown as ApiCallLogRepo;

    const emptyInner = createMockAdapter({
      getOhlcv: vi.fn(async () => []),
    });
    const emptyAdapter = createInstrumentedBrokerAdapter(emptyInner, {
      apiCallLogRepo,
      brokerAccountId: "broker-1",
      provider: "alpaca",
    });
    await emptyAdapter.getOhlcv?.("SPY", "1h", 21);
    expect(inserts.at(-1)).toMatchObject({
      call_type: "getOhlcv",
      status: "empty",
    });

    const partialInner = createMockAdapter({
      getOhlcv: vi.fn(async () => [
        {
          ts: "2026-07-20T15:00:00.000Z",
          open: 1,
          high: 2,
          low: 0.5,
          close: 1.5,
          volume: 10,
        },
      ]),
    });
    const partialAdapter = createInstrumentedBrokerAdapter(partialInner, {
      apiCallLogRepo,
      brokerAccountId: "broker-1",
      provider: "alpaca",
    });
    await partialAdapter.getOhlcv?.("SPY", "1h", 21);
    expect(inserts.at(-1)).toMatchObject({
      call_type: "getOhlcv",
      status: "partial",
    });
  });

  it("calls a class-based inner adapter's getOhlcv with `this` intact (regression for detached-method bug)", async () => {
    // A plain-object mock's methods don't depend on `this`, so it can't
    // reproduce the real bug: instrumented-broker-adapter.ts used to
    // destructure `const getOhlcv = inner.getOhlcv`, losing `this` — any
    // class-based adapter calling `this.xyz()` inside getOhlcv then threw.
    class ClassAdapter {
      readonly brokerType = "mock";
      readonly supportedInstrumentClasses = ["stock"] as const;
      readonly launchCapable = true;
      private now(): string {
        return "2026-01-01T00:00:00.000Z";
      }
      async getOhlcv() {
        const ts = this.now();
        return [{ ts, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }];
      }
    }
    const inner = new ClassAdapter() as unknown as BrokerAdapter;
    const adapter = createInstrumentedBrokerAdapter(inner, {
      apiCallLogRepo: { insert: vi.fn() } as unknown as ApiCallLogRepo,
      brokerAccountId: "broker-1",
      provider: "alpaca",
    });

    await expect(adapter.getOhlcv?.("SPY", "1h", 10)).resolves.toMatchObject([
      { ts: "2026-01-01T00:00:00.000Z" },
    ]);
  });

  it("omits getOhlcv when the inner adapter does not implement it", () => {
    const inner = createMockAdapter();
    delete inner.getOhlcv;
    const adapter = createInstrumentedBrokerAdapter(inner, {
      apiCallLogRepo: { insert: vi.fn() } as unknown as ApiCallLogRepo,
      brokerAccountId: "broker-1",
      provider: "mock",
    });

    expect(adapter.getOhlcv).toBeUndefined();
  });

  it("preserves market discovery methods through the instrumentation wrapper", async () => {
    const inserts: unknown[] = [];
    const fetchMarketCandidates = vi.fn(async () => []);
    const inner = Object.assign(createMockAdapter(), {
      fetchMarketCandidates,
    }) as BrokerAdapter & MarketDiscoveryAdapter;
    const adapter = createInstrumentedBrokerAdapter(inner, {
      apiCallLogRepo: {
        insert: (entry: unknown) => inserts.push(entry),
      } as unknown as ApiCallLogRepo,
      brokerAccountId: "broker-1",
      provider: "polymarket",
    });

    expect(isMarketDiscoveryAdapter(adapter)).toBe(true);
    if (!isMarketDiscoveryAdapter(adapter))
      throw new Error("Expected discovery adapter");
    await adapter.fetchMarketCandidates();

    expect(fetchMarketCandidates).toHaveBeenCalledOnce();
    expect(inserts.at(-1)).toMatchObject({
      call_type: "fetchMarketCandidates",
      endpoint: "broker-1/markets",
      status: "ok",
    });
  });
});
